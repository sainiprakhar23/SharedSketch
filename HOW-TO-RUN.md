# SharedSketch — Step-by-Step Deployment & Execution Guide

This guide walks you through deploying the **SharedSketch** platform to AWS step-by-step. At the end of this guide, you will receive a **Public IP address** that you can open in your web browser to use the collaborative drawing canvas live.

---

## What We Are Building & Deploying

1. **AWS Infrastructure:** A Free-Tier eligible `t3.micro` Ubuntu virtual server (with 4 GB swap memory to protect your $100 budget), 30 GB encrypted storage, Amazon ECR repository, and network security.
2. **Kubernetes Cluster:** A lightweight K3s cluster running on the server.
3. **Application Stack:** Replicated SharedSketch pods connected to an internal Redis service for real-time multi-user drawing sync.
4. **Access:** Public HTTP/WebSocket access directly via the server's **Public IP address**.

---

## Prerequisites

Before starting, make sure you have:
1. **Your AWS Credentials:**
   - An AWS **Access Key ID** (starts with `AKIA...`)
   - An AWS **Secret Access Key**
   *(Obtained from the AWS Management Console under IAM -> Users -> Security credentials -> Create access key)*
2. **Terraform:** Already installed and verified on your system (`v1.15.5`).
3. **AWS CLI on Windows:** If you don't have AWS CLI yet, install it by running this in PowerShell:
   ```powershell
   msiexec.exe /i https://awscli.amazonaws.com/AWSCLIV2.msi /qn
   ```

---

## Step 1: Where & How to Insert Your AWS Credentials (Safe & Secure)

> [!IMPORTANT]
> **Safety Rule:** Never paste your AWS keys into project code files, `.tf` files, or git commits.

Set your credentials **directly in your own Windows PowerShell window** for the current terminal session:

Open **PowerShell** and run these commands (replace the placeholder text with your actual AWS keys):

```powershell
$env:AWS_ACCESS_KEY_ID="AKIAEXAMPLEKEYID"
$env:AWS_SECRET_ACCESS_KEY="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
$env:AWS_DEFAULT_REGION="ap-south-1"
```

### Verify Your Credentials
Test that AWS recognizes your credentials:

```powershell
aws sts get-caller-identity
```

**Expected output:**
```json
{
    "UserId": "AIDA...",
    "Account": "123456789012",
    "Arn": "arn:aws:iam::123456789012:user/your-user"
}
```

---

## Step 2: Provision AWS Infrastructure with Terraform

Now that your credentials are set in PowerShell, let Terraform create your cloud infrastructure.

### 1. Navigate to the Terraform folder:
```powershell
cd d:\INT-378\infra\terraform
```

### 2. Initialize Terraform:
```powershell
terraform init
```

### 3. Generate the Plan:
```powershell
terraform plan -out=tfplan
```
This shows you all resources Terraform will create (`aws_instance`, `aws_vpc`, `aws_ecr_repository`, `aws_security_group`, etc.).

### 4. Apply and Build:
```powershell
terraform apply tfplan
```
*Wait 2–3 minutes while AWS provisions your server and runs the automated bootstrap script (which installs Docker, K3s, and Helm).*

---

## Step 3: Get Your Server's Public IP Address

Once `terraform apply` finishes, Terraform will automatically display your server's Public IP address in the terminal:

```powershell
terraform output ec2_public_ip
```

**Example output:**
```text
13.233.45.120
```

> [!TIP]
> **Copy this IP address!** This is the address you will use to open the application in your browser.

You can also view the Amazon ECR URL and SSM connection command:
```powershell
terraform output
```

---

## Step 4: Connect to Your Server (No SSH Keys Needed!)

Your server is secured with **AWS Systems Manager (SSM)**. You do not need SSH keys or open port 22.

Connect directly from your local PowerShell:
```powershell
aws ssm start-session --target $(terraform output -raw ec2_instance_id) --region ap-south-1
```
*(Alternatively: Go to AWS Web Console -> EC2 -> Select your instance `sharedsketch-k3s-host` -> Click **Connect** -> Choose **Session Manager** -> Click **Connect**)*

Once connected, switch to root or ubuntu user:
```bash
sudo su - ubuntu
```

### Check Cluster Health on the Server:
```bash
# Verify K3s node is Ready
kubectl get nodes

# Verify core system pods are Running
kubectl get pods -n kube-system
```

---

## Step 5: Deploy SharedSketch on the Cluster

From your session inside the EC2 server, deploy the application using the Helm chart:

### Option A: Quick 1-Command Deployment (Build & Run on Server)
```bash
# Clone the repository onto the server
git clone https://github.com/sainiprakhar23/SharedSketch.git /home/ubuntu/SharedSketch
cd /home/ubuntu/SharedSketch

# Build the container image locally on the server
sudo docker build -t sharedsketch:v1 .

# Deploy via Helm chart to K3s
sudo helm upgrade --install sharedsketch ./k8s/helm/sharedsketch \
  --namespace sharedsketch --create-namespace \
  --set image.repository=sharedsketch \
  --set image.tag=v1 \
  --set image.pullPolicy=Never \
  --wait --timeout 5m
```

### Verify Deployment Status:
```bash
sudo kubectl get pods -n sharedsketch -o wide
sudo kubectl get svc -n sharedsketch
sudo kubectl get ingress -n sharedsketch
```

You should see:
- `sharedsketch-xxxx` (2 pods running)
- `sharedsketch-redis-xxxx` (1 Redis pod running)
- `traefik` ingress routing traffic to port 3000

---

## Step 6: Open the Project in Your Browser!

Open your favorite web browser (Chrome, Edge, Firefox, Safari) and navigate to your Public IP:

```text
http://<YOUR_EC2_PUBLIC_IP>/
```
*(Example: `http://13.233.45.120/`)*

### Test the Collaborative Canvas:
1. Enter your name (e.g., **Alice**) and click **Create Room**.
2. Copy the generated **Room ID** (e.g. `ABC123XYZ456`).
3. Click **Proceed to Canvas** and draw with the brush, shapes, and colors.
4. **Open a second browser tab (or incognito window)**:
   - Navigate to `http://<YOUR_EC2_PUBLIC_IP>/`.
   - Enter another name (e.g., **Bob**), choose **Join Room**, and paste the Room ID.
5. **Watch the real-time sync:**
   - Both users see each other's cursor positions with their names!
   - Drawings in Tab 1 instantly appear in Tab 2 via the Redis pub/sub adapter!
   - Click **Undo** — notice that the stroke is removed across both tabs in real time!

---

## Step 7: How to Access Dashboards (Grafana & Kubernetes Dashboard)

For security, administrative dashboards are kept internal and not exposed to the public Internet. You access them securely using **local port forwarding**.

---

### 7A. How to View the Grafana Metrics Dashboard

The Grafana dashboard displays real-time application metrics (active WebSocket connections, active rooms, HTTP request latency, socket events, and pod memory).

#### 1. Install the Monitoring Stack (Run inside your EC2 server session):
```bash
# Add the official Prometheus Helm repository
sudo helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
sudo helm repo update

# Install the resource-tuned monitoring stack
sudo helm upgrade --install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring --create-namespace \
  -f /home/ubuntu/SharedSketch/monitoring/kube-prometheus-stack-values.yaml \
  --wait --timeout 8m

# Apply SharedSketch alert rules
sudo kubectl apply -f /home/ubuntu/SharedSketch/monitoring/prometheus-rules/sharedsketch-alerts.yaml -n monitoring
```

#### 2. Forward Grafana Port to Your Machine:
In your **local Windows PowerShell**:
```powershell
aws ssm start-session --target $(terraform output -raw ec2_instance_id) --document-name AWS-StartPortForwardingSession --parameters "portNumber"=["80"],"localPortNumber"=["3001"]
```

#### 3. Open Grafana in Your Browser:
- Open **[http://localhost:3001](http://localhost:3001)** in your browser.
- **Username:** `admin`
- **Password:** `admin`
- Click **Dashboards** -> **New** -> **Import** -> Upload or paste the contents of [`monitoring/grafana-dashboards/sharedsketch-dashboard.json`](file:///d:/INT-378/monitoring/grafana-dashboards/sharedsketch-dashboard.json).
- **Enjoy the live metrics:** Watch the active WebSocket gauge increase as users join canvas rooms!

---

### 7B. How to View the Kubernetes Dashboard

The Kubernetes Dashboard provides a graphical web interface to inspect your cluster nodes, namespaces, pods, deployments, replica counts, CPU/memory usage, and pod logs.

#### 1. Install Kubernetes Dashboard (Run inside your EC2 server session):
```bash
# Deploy the official Kubernetes Dashboard
sudo kubectl apply -f https://raw.githubusercontent.com/kubernetes/dashboard/v2.7.0/aio/deploy/recommended.yaml
```

#### 2. Create an Admin Account & Generate Login Token:
```bash
# Create service account and bind admin permissions
sudo kubectl create serviceaccount admin-user -n kubernetes-dashboard
sudo kubectl create clusterrolebinding admin-user-binding --clusterrole=cluster-admin --serviceaccount=kubernetes-dashboard:admin-user

# Generate your login bearer token (Copy the output!)
sudo kubectl -n kubernetes-dashboard create token admin-user
```
*(Copy the long token string printed in the terminal — you will use it to log in!)*

#### 3. Forward Kubernetes Dashboard Port to Your Machine:
In your **local Windows PowerShell**:
```powershell
aws ssm start-session --target $(terraform output -raw ec2_instance_id) --document-name AWS-StartPortForwardingSession --parameters "portNumber"=["8443"],"localPortNumber"=["8443"]
```

#### 4. Open Kubernetes Dashboard in Your Browser:
- Open **[https://localhost:8443](https://localhost:8443)** in your browser.
  *(Your browser will display a privacy/certificate warning because the dashboard uses a self-signed HTTPS certificate. Click **Advanced** -> **Proceed to localhost (unsafe)**).*
- Select the **Token** authentication option.
- Paste the **admin-user token** you generated in step 2.
- Click **Sign in**.

**What you will see:**
- A full visual overview of your K3s cluster.
- In the top dropdown, select the `sharedsketch` namespace to view:
  - Your 2 running `sharedsketch` application pods.
  - The `sharedsketch-redis` pod.
  - Real-time CPU and Memory utilization graphs.
  - Live container logs by clicking the 3 dots next to any pod -> **View logs**!

---

## Step 8: How to Tear Down & Destroy to Save Your $100 Credits

When you are done testing and want to ensure you are **never charged** for ongoing server hours:

In your local Windows PowerShell:

```powershell
cd d:\INT-378\infra\terraform
terraform destroy
```

Type `yes` when prompted.

Terraform will delete the EC2 instance, EBS storage volume, ECR repository, and VPC networking cleanly. Your $100 budget will remain protected.

---

## Summary of Key Commands

| Action | Command | Where to Run |
|---|---|---|
| **Set Credentials** | `$env:AWS_ACCESS_KEY_ID="..."; $env:AWS_SECRET_ACCESS_KEY="..."` | Local Windows PowerShell |
| **Create Server** | `cd infra\terraform; terraform apply` | Local Windows PowerShell |
| **Get Public IP** | `terraform output ec2_public_ip` | Local Windows PowerShell |
| **Connect to Server** | `aws ssm start-session --target $(terraform output -raw ec2_instance_id)` | Local Windows PowerShell |
| **Deploy App** | `sudo helm upgrade --install sharedsketch ./k8s/helm/sharedsketch ...` | Inside EC2 Server |
| **Open Canvas App** | Open `http://<EC2_PUBLIC_IP>/` in your browser | Web Browser |
| **View Grafana** | Forward port 80 to 3001 via SSM -> Open `http://localhost:3001` | Local PowerShell & Browser |
| **View K8s Dashboard** | Forward port 8443 to 8443 via SSM -> Open `https://localhost:8443` | Local PowerShell & Browser |
| **Delete Server** | `cd infra\terraform; terraform destroy` | Local Windows PowerShell |
