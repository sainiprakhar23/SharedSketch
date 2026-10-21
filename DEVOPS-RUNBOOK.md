# SharedSketch — DevOps & Cloud Platform Runbook

This runbook provides end-to-end operational instructions for provisioning, deploying, operating, troubleshooting, and tearing down the SharedSketch delivery platform on an AWS EC2-hosted K3s cluster.

---

## 1. System Architecture

```text
Developer pushes to GitHub (main)
              │
              ▼
    GitHub Webhook (HTTPS) or SCM Polling (10 min fallback)
              │
              ▼
    Jenkins Pipeline (AWS EC2 Host)
      ├── 1. Checkout commit SHA
      ├── 2. npm ci && npm test (unit & scaling tests)
      ├── 3. Build Docker image with immutable tag (GIT_COMMIT)
      ├── 4. Authenticate to Amazon ECR via EC2 IAM Instance Profile
      ├── 5. Push container image to Amazon ECR
      ├── 6. Helm lint & dry-run template check
      ├── 7. Helm deploy to K3s cluster (namespace: sharedsketch)
      ├── 8. Post-deploy smoke test (/health & socket handshake)
      └── 9. Automated rollback on failure (helm rollback)
              │
              ▼
    Amazon ECR ─────────► K3s Kubernetes (Ubuntu 24.04 EC2)
                                │
                      ┌─────────┴─────────┐
                      ▼                   ▼
             SharedSketch Pods      Redis Service
            (Express + Socket.IO)  (PubSub + State)
                      │                   │
                      └──── Redis Adapter ┘
                                │
                                ▼
                       Prometheus (/metrics)
                                │
                                ▼
                             Grafana
```

---

## 2. Infrastructure Setup (AWS & Terraform)

### Prerequisites
- Terraform v1.5+ installed locally.
- AWS CLI configured with your credentials in your local terminal (`aws configure` or `$env:AWS_PROFILE`).
- **Safety Rule:** Never paste AWS credentials or secrets into project code, markdown files, or chat prompts.

### Step 1: Initialize and Plan
`[Windows PowerShell — local]`
```powershell
cd d:\INT-378\infra\terraform

# Copy and review variable defaults
cp terraform.tfvars.example terraform.tfvars

# Format check and initialization
terraform fmt -check
terraform init
terraform validate

# Review execution plan
terraform plan -out=tfplan
```

### Step 2: Apply Infrastructure
`[Windows PowerShell — local]`
```powershell
# Provision AWS resources (EC2 t3.micro, 30GB EBS gp3, ECR, VPC, IAM role)
terraform apply tfplan
```

### Free Tier & Cost Safeguards
- **Instance Type:** `t3.micro` (Free Tier eligible: 750 hours/month free).
- **Storage:** 30 GB EBS gp3 (Free Tier eligible: 30 GB/month free).
- **Swap Memory:** A 4 GB swapfile is automatically created by `bootstrap.sh` on the host to allow Jenkins, K3s, and Docker builds to run simultaneously without kernel OOM crashes.
- **Budget Impact:** Under your $100 allocated AWS credits, this deployment incurs negligible on-demand cost (~$0.15/day for public IPv4 addressing).

---

## 3. Host Bootstrap & Cluster Verification

### Step 1: Connect to EC2 via AWS Systems Manager (SSM)
No SSH keys or open port 22 are required. Connect using AWS SSM:
`[Windows PowerShell — local]`
```powershell
aws ssm start-session --target <EC2_INSTANCE_ID> --region ap-south-1
```

### Step 2: Verify Host Toolchains & K3s Cluster
`[Ubuntu EC2 — via SSM]`
```bash
# Check memory and swap allocation
free -h

# Check K3s cluster nodes and Traefik ingress
sudo kubectl get nodes -o wide
sudo kubectl get pods -n kube-system

# Verify Docker and Jenkins services
sudo systemctl status docker --no-pager
sudo systemctl status jenkins --no-pager
```

### Step 3: Retrieve Initial Jenkins Admin Password
`[Ubuntu EC2 — via SSM]`
```bash
sudo cat /var/lib/jenkins/secrets/initialAdminPassword
```

### Step 4: Access Jenkins Administrative UI Securely
Port 8080 is intentionally **not** exposed to the Internet. Establish an encrypted port tunnel from your local machine:
`[Windows PowerShell — local]`
```powershell
aws ssm start-session --target <EC2_INSTANCE_ID> --document-name AWS-StartPortForwardingSession --parameters "portNumber"=["8080"],"localPortNumber"=["8080"]
```
Open [http://localhost:8080](http://localhost:8080) in your local browser and complete Jenkins setup.

---

## 4. CI/CD Pipeline Configuration (Jenkins)

1. **Create Pipeline Job:**
   - In Jenkins, click **New Item** -> Name: `sharedsketch-pipeline` -> Select **Pipeline**.
   - Under **Build Triggers**, select **GitHub hook trigger for GITScm polling** or configure **Poll SCM** (`H/10 * * * *`).
   - Under **Pipeline**, select **Pipeline script from SCM** -> Git -> Repository URL: `https://github.com/sainiprakhar23/SharedSketch.git` -> Branch: `*/main` -> Script Path: `Jenkinsfile`.
2. **ECR Authentication:**
   - The EC2 host uses the attached IAM instance profile (`sharedsketch-ec2-role`). No AWS credentials or static access keys are needed in Jenkins Credentials.

---

## 5. Kubernetes & Multi-Pod Operations

### Deploying the Helm Release Manually
`[Ubuntu EC2 — via SSM]`
```bash
# Deploy with an immutable commit-SHA tag
sudo helm upgrade --install sharedsketch ./k8s/helm/sharedsketch \
  --namespace sharedsketch --create-namespace \
  --set image.repository=<ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com/sharedsketch \
  --set image.tag=<GIT_COMMIT_SHA> \
  --wait --timeout 5m
```

### Scaling Up & Testing Multi-Pod State Sharing
1. **Scale Deployment to 3 Replicas:**
   ```bash
   sudo kubectl scale deployment/sharedsketch -n sharedsketch --replicas=3
   sudo kubectl get pods -n sharedsketch -o wide
   ```
2. **Multi-Pod Verification Test:**
   - Open two browser tabs to `http://<EC2_PUBLIC_IP>/`.
   - Create room `TEAM-ROOM` in Tab 1 (Client A).
   - Join room `TEAM-ROOM` in Tab 2 (Client B).
   - Tab 1 and Tab 2 land on different pods behind Traefik.
   - Draw in Tab 1 -> Tab 2 displays the stroke in real time via Redis adapter broadcast.
   - Click **Undo** in Tab 1 -> Redis removes stroke atomically and emits `full-history-update` across all pods.
3. **Verify Horizontal Pod Autoscaler (HPA):**
   ```bash
   sudo kubectl get hpa -n sharedsketch
   ```

---

## 6. Monitoring & Observability (Prometheus & Grafana)

### Step 1: Install Monitoring Stack
`[Ubuntu EC2 — via SSM]`
```bash
# Add prometheus-community chart repo
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# Install resource-tuned stack
sudo helm upgrade --install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring --create-namespace \
  -f ./monitoring/kube-prometheus-stack-values.yaml \
  --wait --timeout 8m

# Apply SharedSketch alert rules
sudo kubectl apply -f ./monitoring/prometheus-rules/sharedsketch-alerts.yaml -n monitoring
```

### Step 2: Access Grafana Securely
`[Windows PowerShell — local]`
```powershell
# Establish local port-forward to Grafana ClusterIP service (port 80)
aws ssm start-session --target <EC2_INSTANCE_ID> --document-name AWS-StartPortForwardingSession --parameters "portNumber"=["80"],"localPortNumber"=["3001"]
```
Open [http://localhost:3001](http://localhost:3001) in your browser:
- Username: `admin`
- Password: `admin` (or configured value in values.yaml)
- Navigate to **Dashboards** -> Import [`monitoring/grafana-dashboards/sharedsketch-dashboard.json`](file:///d:/INT-378/monitoring/grafana-dashboards/sharedsketch-dashboard.json).

---

## 7. Rollback & Disaster Recovery

### Automatic Rollback
If a deployment fails health checks or times out during `helm upgrade`, the Jenkinsfile `post { failure { ... } }` block triggers `helm rollback sharedsketch -n sharedsketch` automatically.

### Manual Rollback
`[Ubuntu EC2 — via SSM]`
```bash
# 1. View deployment revision history
sudo helm history sharedsketch -n sharedsketch

# 2. Roll back to specific revision (e.g., revision 1)
sudo helm rollback sharedsketch 1 -n sharedsketch

# 3. Verify pods rolled back to previous image tag
sudo kubectl get pods -n sharedsketch -o jsonpath='{..image}'
```

---

## 8. Common Troubleshooting

| Issue | Root Cause | Remediation |
|---|---|---|
| Memory exhaustion / process killed | Host RAM exceeded on `t3.micro` | Ensure `/swapfile` (4GB) is active: `swapon --show`. Check memory: `free -m`. |
| `CrashLoopBackOff` on `sharedsketch` pod | Redis is unreachable | Verify Redis pod status: `kubectl get pods -n sharedsketch -l component=redis`. Check `/ready` probe logs. |
| Image pull failure (`ImagePullBackOff`) | EC2 instance profile missing ECR permissions | Verify IAM role attached to EC2: `aws sts get-caller-identity`. Ensure ECR policy allows `ecr:BatchGetImage`. |
| WebSocket disconnection / 404 | Traefik entrypoint misconfigured | Check Traefik ingress logs: `kubectl logs -n kube-system -l app.kubernetes.io/name=traefik`. |

---

## 9. Safe Teardown & Cost Cleanup

To prevent ongoing AWS charges after completing the learning lab, tear down all provisioned resources:

### Step 1: Uninstall Helm Releases
`[Ubuntu EC2 — via SSM]`
```bash
sudo helm uninstall sharedsketch -n sharedsketch || true
sudo helm uninstall prometheus -n monitoring || true
```

### Step 2: Destroy Terraform Infrastructure
`[Windows PowerShell — local]`
```powershell
cd d:\INT-378\infra\terraform

# Review destruction plan
terraform plan -destroy -out=destroy.plan

# Terminate EC2, delete EBS volume, VPC, and ECR repository
terraform apply destroy.plan
```

### Step 3: Verify Zero Dangling Resources
Check the AWS Console or run:
```powershell
aws ec2 describe-instances --filters "Name=tag:Project,Values=SharedSketch" "Name=instance-state-name,Values=running"
```
Ensure 0 running instances remain.
