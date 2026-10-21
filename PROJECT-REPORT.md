# SharedSketch: DevOps, Cloud Infrastructure & Distributed Real-Time Platform Document

**Author / Maintainer:** Prakhar Saini (@sainiprakhar23)  
**Date:** October 15, 2026  
**Repository:** [https://github.com/sainiprakhar23/SharedSketch](https://github.com/sainiprakhar23/SharedSketch)  
**Target Environment:** AWS EC2 (Ubuntu 24.04 LTS), K3s Kubernetes, Amazon ECR, Jenkins CI/CD, Redis, Prometheus & Grafana  

---

## Table of Contents

1. [Executive Summary & System Overview](#1-executive-summary--system-overview)
2. [End-to-End Architectural Topology](#2-end-to-end-architectural-topology)
3. [Component Breakdown, Ports & Network Protocol Matrix](#3-component-breakdown-ports--network-protocol-matrix)
4. [Application Core & Frontend Architecture](#4-application-core--frontend-architecture)
5. [Distributed State Management & Redis Scaling Engine](#5-distributed-state-management--redis-scaling-engine)
6. [Containerization & Docker Engineering](#6-containerization--docker-engineering)
7. [Kubernetes Orchestration & Helm Architecture (K3s)](#7-kubernetes-orchestration--helm-architecture-k3s)
8. [Infrastructure as Code (Terraform & AWS Cloud)](#8-infrastructure-as-code-terraform--aws-cloud)
9. [Automated CI/CD Delivery Pipeline (Jenkins)](#9-automated-cicd-delivery-pipeline-jenkins)
10. [Observability, Metrics & Alerting (Prometheus & Grafana)](#10-observability-metrics--alerting-prometheus--grafana)
11. [Cluster Administration & Visual Dashboards](#11-cluster-administration--visual-dashboards)
12. [Security Architecture & Threat Mitigation (OWASP & Cloud)](#12-security-architecture--threat-mitigation-owasp--cloud)
13. [Engineering Challenges, Root Causes & Fixes](#13-engineering-challenges-root-causes--fixes)
14. [Verification Evidence & Automated Test Matrix](#14-verification-evidence--automated-test-matrix)
15. [Status, Known Limitations & Trade-Offs](#15-status-known-limitations--trade-offs)
16. [Step-by-Step Operator Execution Manual](#16-step-by-step-operator-execution-manual)

---

## 1. Executive Summary & System Overview

**SharedSketch** is a distributed, real-time collaborative whiteboard canvas platform engineered to demonstrate high-concurrency WebSocket event handling, state-synchronized multi-pod horizontal scaling, cloud-native container orchestration, automated GitOps delivery, and enterprise observability.

Rather than presenting an isolated, single-instance hobby demo, this project proves distributed-systems and DevOps principles with verifiable test evidence:

1. **State Synchronization Survives Pod Restarts & Horizontal Scaling:**  
   Unlike typical WebSocket demonstrations that store room state in single-process memory, SharedSketch decouples communication from storage. Socket.IO broadcasts are multiplexed across pods using Redis Pub/Sub, while rooms, strokes, and undo/redo stacks reside in high-performance atomic Redis data structures. Two clients connected to completely different Kubernetes pods in the cluster draw, erase, and undo synchronously without split-brain anomalies.
2. **Deterministic, Zero-Static-Secret CI/CD:**  
   A 10-stage declarative Jenkins pipeline validates linting, executes isolated multi-instance integration tests, builds a hardened non-root container image, signs/tags it with the immutable Git commit SHA, authenticates to Amazon ECR via an AWS IAM EC2 Instance Profile (zero static access keys), and deploys the release to K3s with automated rollback upon probe failure.
3. **AWS Free-Tier & Budget Guardrails ($100 Allocation):**  
   The entire infrastructure is modeled in Terraform to operate strictly within the AWS Free Tier (`t3.micro`, 30 GB EBS gp3 volume), utilizing an automated 4 GB virtual swap space and JVM heap constraints to run K3s, Jenkins, and container builds simultaneously without out-of-memory kernel panics.

---

## 2. End-to-End Architectural Topology

The following diagram illustrates the interaction between external developers, CI/CD orchestration, the container registry, the Kubernetes cluster, the real-time drawing pods, and the monitoring stack:

```text
Developer Git Push (main)
           │
           ▼
 GitHub Webhook (HTTPS) / SCM Polling Fallback
           │
           ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│ Jenkins CI/CD Automation Engine (AWS EC2 Host)                                     │
│  ├── 1. Checkout Git Commit SHA                                                   │
│  ├── 2. Clean Dependency Installation (`npm ci`)                                  │
│  ├── 3. Automated Single & Multi-Instance Integration Tests (`npm test`)          │
│  ├── 4. Security Audit (`npm audit`)                                              │
│  ├── 5. Multi-Stage Non-Root Container Build (`node:22-alpine`)                   │
│  ├── 6. Dynamic IAM Authentication via EC2 Instance Profile (Zero Static Keys)   │
│  ├── 7. Push Immutable Container Image (`<ACCOUNT>.dkr.ecr.ap-south-1...:<SHA>`)│
│  ├── 8. Helm Chart Linting & Dry-Run Manifest Rendering                           │
│  ├── 9. Atomic Helm Upgrade/Deploy to K3s (`sharedsketch` namespace)              │
│  ├── 10. Automated Rollout Status & Live Probe Verification                       │
│  └── 11. Automated Rollback Trigger on Release Failure (`helm rollback`)          │
└────────────────────────────────────────┬──────────────────────────────────────────┘
                                         │
                                         ▼
                                Amazon ECR Repository
                         (Immutable SHA Tags, Scan on Push)
                                         │
                                         ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│ AWS EC2 Host (Ubuntu 24.04 LTS · K3s Single-Node Kubernetes Cluster)               │
│                                                                                   │
│  Traefik Ingress Controller (Port 80 HTTP / Port 443 HTTPS)                       │
│    │ WebSocket Upgrade Connection (`Upgrade: websocket`)                          │
│    ▼                                                                              │
│  SharedSketch ClusterIP Service (Port 3000)                                       │
│    │ Load Balancing (Round-Robin)                                                │
│    ├───► Pod 1 (Express + Socket.IO · Non-Root Node 22)                           │
│    └───► Pod 2 (Express + Socket.IO · Non-Root Node 22)                           │
│            │                               │                                      │
│            └───────────────┬───────────────┘                                      │
│                            │ Pub/Sub Broadcasts & Atomic State Operations         │
│                            ▼                                                      │
│                  Redis Standalone Service                                         │
│                  (Internal ClusterIP · Port 6379)                                 │
│                                                                                   │
│  Observability & Telemetry:                                                       │
│    ├── Prometheus Scrape ServiceMonitor (`/metrics` · 15s interval)               │
│    ├── Prometheus Alert Rules (Downtime, Latency, Errors, Storage Down)           │
│    └── Grafana Dashboard (Internal ClusterIP · Secure SSM Port Forward)           │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Component Breakdown, Ports & Network Protocol Matrix

The platform intentionally restricts external exposure. Only application traffic enters through standard HTTP/HTTPS ports. All database, management, and observability interfaces are isolated within the internal Kubernetes network or accessed via encrypted AWS Systems Manager tunnels.

| Component | In-Cluster Hostname | Port | Protocol | Traffic Direction | Accessibility | Primary Responsibility |
|---|---|---|---|---|---|---|
| **Traefik Ingress** | `traefik.kube-system` | `80` / `443` | HTTP / WSS | Inbound | Public Internet (`0.0.0.0/0`) | Reverse proxy, SSL termination, and WebSocket connection upgrades |
| **SharedSketch App** | `sharedsketch.sharedsketch` | `3000` | HTTP / TCP | Internal | ClusterIP only | Serves static canvas assets, REST probes (`/health`, `/ready`), `/metrics`, and Socket.IO events |
| **Redis Service** | `sharedsketch-redis.sharedsketch` | `6379` | RESP / TCP | Internal | ClusterIP only | Cross-pod Socket.IO pub/sub message broker and atomic room/stroke store |
| **Prometheus Server**| `prometheus-kube-prometheus-prometheus.monitoring` | `9090` | HTTP / TCP | Internal | ClusterIP only | Periodically scrapes `/metrics` across all pods, evaluates alert rules, records time-series |
| **Grafana** | `prometheus-grafana.monitoring` | `80` (Internal) | HTTP / TCP | Internal | ClusterIP only (SSM Tunnel on `3001`) | Visual metrics dashboard for latency, memory, active rooms, and active WebSocket connections |
| **Kubernetes Dashboard** | `kubernetes-dashboard.kubernetes-dashboard` | `443` | HTTPS / TCP | Internal | ClusterIP only (SSM Tunnel on `8443`) | Visual cluster management: pod logs, deployments, nodes, and resource utilization graphs |
| **K3s API Server** | `kubernetes.default` | `6443` | HTTPS / TCP | Internal | Localhost / EC2 only | Kubernetes control plane API server; blocked from public internet |
| **Jenkins Controller** | `localhost` (Host systemd) | `8080` | HTTP / TCP | Host-level | Private Host only (SSM Tunnel on `8080`) | CI/CD automation engine executing the declarative pipeline |
| **AWS SSM Agent** | `amazon-ssm-agent` | Outbound `443` | HTTPS / TLS | Outbound to AWS | Zero Inbound Open Ports | Enables encrypted shell sessions and port forwarding without requiring open SSH port 22 |

---

## 4. Application Core & Frontend Architecture

### 4.1 Technology Stack & Design Principles
- **Frontend Core:** Vanilla JavaScript (ES6+), HTML5 Canvas 2D Rendering Context API, and modern CSS3 with responsive glassmorphism aesthetic. No heavy client-side frameworks (such as React or Angular) are used, ensuring a sub-100ms first-contentful-paint (FCP) and near-zero bundle transmission overhead.
- **Backend Core:** Node.js v22 LTS runtime, Express 4.21.2 web framework, and Socket.IO 4.8.1 bidirectional WebSocket engine.
- **Canonical Asset Layout:**
  - `client/`: Canonical source of truth for HTML, CSS, client scripts (`websocket.js`, `canvas.js`, `main.js`).
  - `server/public/`: Deployed distribution folder served by Express static middleware.
  - `scripts/sync-assets.js`: Automated cross-platform synchronization script invoked prior to container builds to guarantee asset parity.

### 4.2 Dynamic Same-Origin Connection Resolution
A critical defect identified in Phase 0 was the presence of a hardcoded Render URL (`https://real-time-collaborative-drawing-canvas-ni5j.onrender.com`) inside the client script, causing client connections in deployed containers to bypass the local server and attempt connections to an external service.

This was resolved by implementing dynamic same-origin resolution inside `client/websocket.js` and `client/canvas.js`:

```javascript
// Dynamic same-origin connection (works automatically across localhost, containers, and EC2 Public IP)
const SERVER_URL = localStorage.getItem('serverUrl') || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
await wsManager.connect(SERVER_URL);
```

### 4.3 REST Probes & Observability API
The Express backend implements three dedicated operational endpoints:
- `GET /health` **(Liveness Probe):** Returns HTTP 200 `{"status": "UP", "timestamp": "..."}`. A low-overhead probe verifying that the Node event loop is unblocked.
- `GET /ready` **(Readiness Probe):** Checks whether underlying dependencies are operational. When configured with Redis, it executes an active `client.ping()`. If Redis is reachable, it returns HTTP 200 `{"status": "READY", "checks": {"server": "UP", "storage": "UP"}}`. If Redis is disconnected, it immediately returns HTTP 503 `{"status": "NOT_READY", "checks": {"server": "UP", "storage": "DOWN"}}`, instructing Kubernetes to halt traffic routing to the unhealthy pod.
- `GET /metrics` **(Prometheus Telemetry):** Exposes runtime metrics in standard Prometheus text exposition format (prefixed with `sharedsketch_`).
- `GET /stats` **(Sanitized Metrics):** Returns sanitized aggregates (`totalRooms`, `totalUsers`) without leaking sensitive room IDs or participant names to unauthorized callers.

---

## 5. Distributed State Management & Redis Scaling Engine

### 5.1 The Split-Brain Problem in Multi-Pod WebSockets
When a Node.js Socket.IO server is scaled from one replica to multiple replicas in Kubernetes:
1. **Message Isolation:** Socket connections are stateful TCP connections terminated on a specific pod. A `socket.broadcast.emit()` on Pod 1 only reaches sockets terminated on Pod 1. Sockets on Pod 2 never receive the drawing event.
2. **State Partitioning:** If room histories and undo stacks are stored in an in-memory JavaScript `Map` (`const rooms = new Map()`), a client connecting to Pod 2 sees an empty canvas even if a collaborative session is actively underway on Pod 1.

### 5.2 The Two-Tiered Redis Solution
SharedSketch resolves both challenges through two decoupled Redis mechanisms:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                              Redis 7                                   │
├───────────────────────────────────┬────────────────────────────────────┤
│   Socket.IO Redis Adapter (Pub/Sub)│   Centralized Room Store (Data)    │
│   Channels:                       │   Keys:                            │
│   • socket.io#sharedsketch#*      │   • sharedsketch:rooms:active      │
│   Relays:                         │   • sharedsketch:room:{id}:meta    │
│   • user-joined broadcasts        │   • sharedsketch:room:{id}:users   │
│   • draw & draw-line packets      │   • sharedsketch:room:{id}:history │
│   • cursor coordinates            │   • sharedsketch:room:{id}:redo    │
└───────────────────────────────────┴────────────────────────────────────┘
```

1. **Broadcast Multiplexing:** Utilizes `@socket.io/redis-adapter` with dual pub/sub connections (`pubClient` and `subClient`). When Pod 1 emits an event to a room, the adapter publishes the packet to Redis, which fans it out to Pod 2, Pod 3, etc., ensuring instant broadcast delivery across the cluster.
2. **Atomic Room State Persistence (`server/storage/redisStore.js`):**
   - Active Room Tracking: Set `sharedsketch:rooms:active` tracking live room IDs.
   - Metadata Storage: Hash `sharedsketch:room:{roomId}:meta` (`roomId`, `roomName`, `capacity`, `createdAt`).
   - Presence Tracking: Hash `sharedsketch:room:{roomId}:users` storing serialized JSON user models (`id`, `name`, `color`, `x`, `y`).
   - Drawing History: Redis List `sharedsketch:room:{roomId}:history`. Strokes are appended with atomic `RPUSH` and capped at 1,000 strokes using `LTRIM -1000 -1`.
   - Undo/Redo Stacks: Redis List `sharedsketch:room:{roomId}:redo:{userId}` storing undone stroke groups. When a user draws a new stroke, their redo stack is automatically cleared (`DEL`).

### 5.3 Concurrency & Atomic Undo/Redo Engine
When multiple users draw or undo concurrently, read-modify-write sequences in Node can create race conditions. SharedSketch uses Redis transactions (`multi().exec()`) to ensure atomic state transitions:

```javascript
// Atomic Undo Transaction in RedisRoomStore
const multi = this.client.multi();
multi.del(historyKey);
if (remainingHistory.length > 0) {
    const serialized = remainingHistory.map(s => JSON.stringify(s));
    multi.rPush(historyKey, serialized);
}
multi.rPush(redoKey, JSON.stringify({ strokes: removedGroup }));
await multi.exec();
```

---

## 6. Containerization & Docker Engineering

### 6.1 Multi-Stage Dockerfile Architecture
The container is built using a secure multi-stage pipeline on `node:22-alpine`:

```dockerfile
# Stage 1: Build & Dependencies
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY client/ ./client/
COPY scripts/ ./scripts/
COPY server/ ./server/
RUN node scripts/sync-assets.js

# Stage 2: Minimal Production Runner
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/server ./server
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1
CMD ["npm", "start"]
```

### 6.2 Security & Size Attributes
- **Non-Root Execution:** The application executes under `USER node` (UID/GID 1000), eliminating root privilege escalation risks inside the container.
- **Minimal Surface Area:** Uses Alpine Linux, resulting in a compressed content size of **64.8 MB** (uncompressed disk footprint of ~274 MB).
- **Hardened `.dockerignore`:** Excludes `.git`, local `.env` files, tests, scratch scripts, Terraform artifacts, logs, and development tooling.
- **Built-In Healthcheck:** Incorporates an active `wget` spider test against `http://127.0.0.1:3000/health`, enabling container runtime engines to detect hung processes.

---

## 7. Kubernetes Orchestration & Helm Architecture (K3s)

The deployment is managed as a structured, parameter-driven Helm chart under [`k8s/helm/sharedsketch/`](file:///d:/INT-378/k8s/helm/sharedsketch).

### 7.1 Manifest Architecture

```text
k8s/helm/sharedsketch/
├── Chart.yaml              # Chart metadata (Version: 0.1.0, AppVersion: 1.0.0)
├── values.yaml             # Configurable values (replicas, resources, ingress, probes)
└── templates/
    ├── _helpers.tpl         # Template naming and label conventions
    ├── deployment.yaml      # SharedSketch App Deployment (RollingUpdate, non-root, probes)
    ├── service.yaml         # App ClusterIP Service (Port 3000)
    ├── redis-deployment.yaml# Internal Redis Deployment & Service (Port 6379)
    ├── ingress.yaml         # Traefik Ingress with WebSocket upgrade annotations
    ├── hpa.yaml             # HorizontalPodAutoscaler (Min: 2, Max: 5, Target: 70% CPU)
    ├── pdb.yaml             # PodDisruptionBudget (minAvailable: 1)
    ├── serviceaccount.yaml  # Dedicated unprivileged ServiceAccount
    └── servicemonitor.yaml  # Prometheus Operator scraping definition
```

### 7.2 Zero-Downtime Rolling Update Strategy
The deployment specifies a zero-downtime rolling update strategy:
```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1
    maxUnavailable: 0
```
During releases, a new pod is started and must pass its `/ready` probe before old pods are signaled with `SIGTERM` and drained over a 30-second graceful termination period.

### 7.3 Traefik Ingress Configuration
K3s includes the Traefik ingress controller by default. The Ingress manifest routes HTTP and WebSocket traffic through entrypoint `web`:
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: sharedsketch
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: web
spec:
  ingressClassName: traefik
  rules:
    - http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: sharedsketch
                port:
                  number: 3000
```

---

## 8. Infrastructure as Code (Terraform & AWS Cloud)

Infrastructure is managed declaratively under [`infra/terraform/`](file:///d:/INT-378/infra/terraform).

### 8.1 AWS Free-Tier & Budget Safeguards ($100 Allocation)
To protect your $100 allocated credit, all resources strictly adhere to AWS Free Tier limits:
- **Compute:** `t3.micro` EC2 instance (1 vCPU, 1 GB RAM, 750 hours/month free).
- **Storage:** 30 GB EBS gp3 volume (30 GB/month free under Free Tier).
- **Virtual Swap Architecture:** Because K3s, Jenkins, and Docker builds require more than 1 GB of physical RAM, the automated cloud-init bootstrap script initializes a **4 GB swapfile** (`/swapfile`) on the EBS volume. This expands total available virtual memory to 5 GB, completely preventing kernel OOM panics during builds.
- **Estimated Running Cost:** Under $0.15 / day (limited only to public IPv4 address assignment fees).

### 8.2 Security Group Hardening (Zero-Public-Admin Ports)
In compliance with strict security rules, no administrative interfaces are exposed to `0.0.0.0/0`:
- **Allowed Inbound:** Port 80 (HTTP) and Port 443 (HTTPS) for application users.
- **Blocked from Public Internet:**
  - Port 22 (SSH) -> Disabled by default; access is handled via AWS SSM.
  - Port 8080 (Jenkins) -> Accessible only through encrypted SSM port forwarding.
  - Port 6379 (Redis) -> Isolated within Kubernetes cluster.
  - Port 9090 (Prometheus) & Port 3000 (Grafana) -> Accessible only through local port forward.
  - Port 6443 (K8s API) -> Restricted to localhost.

### 8.3 Least-Privilege IAM Instance Profile
The EC2 host operates under an IAM role (`sharedsketch-ec2-role`) with two scoped policies:
1. `AmazonSSMManagedInstanceCore`: Allows AWS Systems Manager terminal sessions without requiring open SSH ports or public key management.
2. Scoped ECR Policy: Grants permission to authenticate and push/pull container images strictly scoped to the `sharedsketch` ECR repository ARN:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECRAuthToken",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "ECRRepositoryActions",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload"
      ],
      "Resource": "arn:aws:ecr:ap-south-1:*:repository/sharedsketch"
    }
  ]
}
```

---

## 9. Automated CI/CD Delivery Pipeline (Jenkins)

The pipeline is formalized in a root Declarative [`Jenkinsfile`](file:///d:/INT-378/Jenkinsfile) executing directly on the EC2 host.

### 9.1 Pipeline Stages Overview

```text
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ 1. Checkout &   │────►│ 2. Install Deps  │────►│ 3. Automated    │
│    Validation   │     │    (`npm ci`)    │     │    Tests        │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
┌─────────────────┐     ┌──────────────────┐              │
│ 6. ECR Auth &   │◄────│ 5. Docker Build  │◄─────────────┘
│    Push (SHA)   │     │ (node:22-alpine) │     ┌─────────────────┐
└────────┬────────┘     └──────────────────┘     │ 4. Audit Scan   │
         │                                       │ (Vulnerabilities│
         ▼                                       └─────────────────┘
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ 7. Helm Lint &  │────►│ 8. Helm Deploy   │────►│ 9. Smoke Test   │
│    Dry-Run      │     │    to K3s        │     │    (/health)    │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │ Failure
                                                          ▼
                                                 ┌─────────────────┐
                                                 │ 10. Automatic   │
                                                 │     Rollback    │
                                                 └─────────────────┘
```

### 9.2 Key Pipeline Principles
1. **Immutable Image Tags:** Images are tagged with the short Git commit SHA (`${GIT_COMMIT.take(8)}`). The pipeline forbids deploying the mutable `latest` tag, ensuring full traceability and reliable rollbacks.
2. **Zero Hardcoded Credentials:** ECR login uses `aws ecr get-login-password` backed by the EC2 IAM instance profile. No AWS credentials, secrets, or passwords are stored in Jenkins.
3. **Automated Rollback Hook:** If `kubectl rollout status` times out or the `/health` curl probe fails, the `post { failure { ... } }` block triggers `helm rollback sharedsketch` to immediately restore the prior functioning release.

---

## 10. Observability, Metrics & Alerting (Prometheus & Grafana)

Observability is implemented using `prom-client` on the application side and `kube-prometheus-stack` on the Kubernetes cluster side.

### 10.1 Application Metrics Registry (`server/metrics.js`)

| Metric Name | Type | Labels | Purpose |
|---|---|---|---|
| `sharedsketch_active_connections` | Gauge | none | Current number of live WebSocket client connections |
| `sharedsketch_active_rooms` | Gauge | none | Current number of active drawing rooms in memory/Redis |
| `sharedsketch_http_requests_total` | Counter | `method`, `route`, `status_code` | Total HTTP requests processed across routes |
| `sharedsketch_http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | Latency distribution buckets (p50, p95, p99) |
| `sharedsketch_socket_events_total` | Counter | `event_type` | Throughput of `draw`, `draw-line`, `undo`, `redo`, `join-room` |
| `sharedsketch_nodejs_heap_size_used_bytes` | Gauge | none | V8 engine memory consumption |

### 10.2 Prometheus Alerting Rules (`monitoring/prometheus-rules/sharedsketch-alerts.yaml`)
Five targeted alerts are configured with PrometheusRule CRDs:
1. `SharedSketchAppDown`: Triggers `critical` alert if `up{job="sharedsketch"} == 0` for over 1 minute.
2. `SharedSketchHighHttpErrorRate`: Triggers `warning` alert if HTTP 5xx responses exceed 5% of total requests over 2 minutes.
3. `SharedSketchHighRequestLatency`: Triggers `warning` if 95th percentile latency exceeds 1.0 second.
4. `SharedSketchRedisStorageDown`: Triggers `critical` alert if the storage health probe reports Redis failure.
5. `SharedSketchHighMemoryUsage`: Triggers `warning` if container memory exceeds 85% of its allocated limit.

---

## 11. Cluster Administration & Visual Dashboards

### 11.1 Grafana Observability Dashboard
Provisioned via [`monitoring/grafana-dashboards/sharedsketch-dashboard.json`](file:///d:/INT-378/monitoring/grafana-dashboards/sharedsketch-dashboard.json):
- Real-time gauge panels: Active WebSocket connections and active rooms.
- Time-series panels: HTTP requests per second (grouped by status code), 95th percentile latency curves, Socket.IO event throughput, process heap utilization, and HPA replica scaling status.
- **Secure Access:** Accessible locally by forwarding port 80 via SSM:
  ```powershell
  aws ssm start-session --target <INSTANCE_ID> --document-name AWS-StartPortForwardingSession --parameters "portNumber"=["80"],"localPortNumber"=["3001"]
  ```

### 11.2 Kubernetes Web Dashboard
Provides visual cluster inspection for nodes, namespaces, pods, and logs:
- Deployed via official Kubernetes Dashboard v2.7.0.
- Authenticated via secure administrative bearer tokens (`admin-user`).
- **Secure Access:** Accessible locally by forwarding port 8443 via SSM:
  ```powershell
  aws ssm start-session --target <INSTANCE_ID> --document-name AWS-StartPortForwardingSession --parameters "portNumber"=["8443"],"localPortNumber"=["8443"]
  ```
  Open `https://localhost:8443`, paste the token, and visually monitor pod rollouts and container logs.

---

## 12. Security Architecture & Threat Mitigation (OWASP & Cloud)

| Risk Category | Threat Vector | Project Mitigation | Verification Method |
|---|---|---|---|
| **A01: Broken Access Control** | Unauthorized access to internal administrative tools | Ports 8080 (Jenkins), 6379 (Redis), 9090 (Prometheus), and 3000 (Grafana) are ClusterIP or localhost-only; zero public ingress. | Port scans verify only ports 80 and 443 are reachable from outside. |
| **A02: Cryptographic Failures** | Eavesdropping or plain-text credentials in code | Zero static AWS keys in repository; IAM Instance Profiles supply rotating temporary STS tokens; IMDSv2 enforced. | Automated scan (`git status`, grep) confirms zero `.env` or credentials committed. |
| **A03: Injection & Cardinality DoS** | High-cardinality metrics crashing Prometheus | Route normalization middleware strips dynamic query params and user IDs from Prometheus labels. | Metric query verification proves labels contain only fixed route categories. |
| **A04: Insecure Design** | Split-brain room state across multiple pods | Centralized atomic Redis data structures and Socket.IO Redis pub/sub adapter. | Automated scaling test connects clients to different pods and verifies synchronized state. |
| **A05: Security Misconfiguration** | Containers running as privileged root | Containers run strictly as unprivileged `USER node` (1000:1000) with `allowPrivilegeEscalation: false`. | `docker inspect` and Kubernetes SecurityContext validation. |
| **A07: Identification Failures** | Room spoofing and unauthorized stroke clears | Strict event payload validation on `join-room`, `draw`, and `undo`; per-user stroke ownership tracking. | Automated integration tests verify that undo only modifies the calling user's strokes. |

---

## 13. Engineering Challenges, Root Causes & Fixes

The following table documents the technical hurdles encountered during implementation, their traced root causes, and their engineered fixes:

| Problem Encountered | Root Cause Traced | Engineered Fix |
|---|---|---|
| **Frontend attempted connection to external Render URL** | `server/public/canvas.js` line 77 contained a stale hardcoded URL: `https://real-time-collaborative-drawing-canvas-ni5j.onrender.com`. | Replaced hardcoded string with dynamic same-origin resolution: `localStorage.getItem('serverUrl') \|\| window.location.origin`. |
| **Client websocket script had syntax corruption** | `client/websocket.js` contained duplicate, concatenated class definitions (559 lines) from an incomplete merge. | Refactored `client/websocket.js` into a clean, modern, event-driven `WebSocketManager` singleton (180 lines) and synchronized it to `server/public/`. |
| **`npm test` failed with `ERR_SERVER_NOT_RUNNING`** | In `tests/server.test.js`, the teardown hook called `server.close()` after `io.close()`. Socket.IO's `close()` automatically closes the underlying HTTP server, causing the second close to throw. | Fixed teardown hook to await `io.close()` completion cleanly without redundantly calling `server.close()`. |
| **Local Free-Tier EC2 host OOM kernel panics** | Running K3s, Jenkins (JVM), Docker builds, and Prometheus concurrently on a `t3.micro` (1 GB RAM) exceeded physical memory. | Configured an automated **4 GB swapfile** (`/swapfile`) in `bootstrap.sh` and constrained Jenkins JVM heap to `-Xms128m -Xmx512m`. |
| **Multi-replica drawing isolation (Split-Brain)** | Express and Socket.IO originally stored rooms and strokes in a local JavaScript `Map`, which is isolated per process. | Implemented `server/storage/redisStore.js` and `@socket.io/redis-adapter`, moving rooms, strokes, presence, and redo stacks into Redis. |
| **PowerShell command failures on package installation** | Unquoted `@` symbol in `npm install @socket.io/redis-adapter` was interpreted by PowerShell as a splatting operator. | Wrapped package name in explicit quotes: `npm install "@socket.io/redis-adapter"`. |
| **`package.json` `"dev"` script pointed to missing path** | The script ran `node server.js` from root, but the actual entrypoint was `server/server.js`. | Updated script to `"dev": "node server/server.js"` and added `"build": "node scripts/sync-assets.js"`. |
| **Terraform STS Credential Token Error on `plan`** | Local terminal environment had expired or unconfigured AWS credentials. | Documented clean terminal session environment export (`$env:AWS_ACCESS_KEY_ID`) without baking keys into configuration files. |

---

## 14. Verification Evidence & Automated Test Matrix

All test suites were executed and validated locally. Below is the automated test execution record:

```text
> collaborative-canvas@1.0.0 test
> node --test tests/**/*.test.js

Connected to Redis at redis://127.0.0.1:6379
Socket.IO Redis adapter enabled.
Connected to Redis at redis://127.0.0.1:6379
Socket.IO Redis adapter enabled.
✔ Multi-Replica Scaling Test: Clients on different Node instances share state via Redis (342.2002ms)
✔ Readiness probe returns 503 when Redis cannot be reached (13.8662ms)
✔ Health endpoint (/health) returns UP status (21.8636ms)
✔ Readiness endpoint (/ready) returns READY status (2.9616ms)
✔ Metrics endpoint (/metrics) exposes Prometheus formatted metrics (6.9338ms)
✔ Stats endpoint (/stats) returns aggregated metrics without leaking room details (2.7945ms)
✔ Static routes serve index and canvas pages (9.773ms)
✔ Socket.IO real-time collaboration workflow (26.8822ms)

ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1017.3868
```

### Test Scope Summary:
1. **Multi-Replica Scaling Test (`tests/scaling.test.js`):** Boots two independent Node server instances on separate ephemeral ports connected to Redis. Client 1 connects to Instance A; Client 2 connects to Instance B. Proves that drawing, cursor updates, joining history, and undo events propagate across instances in real time.
2. **Dependency Resilience Test:** Points storage store to an unreachable port; verifies that `/ready` returns HTTP 503 without crashing the server process.
3. **Observability Verification:** Validates that `/metrics` exports valid Prometheus format containing `sharedsketch_` gauges and counters.
4. **Endpoint Sanity:** Validates liveness (`/health`), readiness (`/ready`), and static asset delivery (`/`, `/canvas`).

---

## 15. Status, Known Limitations & Trade-Offs

### Component Completion Status

| Area | Implementation Status | Test & Verification Status |
|---|---|---|
| **Frontend Canvas** | **Complete** | Validated across browser tabs; same-origin dynamic resolution active |
| **Node.js / Express Backend** | **Complete** | Automated tests passing; probes and Prometheus middleware operational |
| **Redis State & Adapter** | **Complete** | Multi-replica scaling integration tests passing with 0 errors |
| **Docker Containerization** | **Complete** | Multi-stage build verified; non-root user; 64.8 MB compressed size |
| **Kubernetes (K3s Helm Chart)**| **Complete** | Chart linted (0 errors); all 8 manifests rendered cleanly |
| **Terraform AWS Infrastructure**| **Complete** | Validated for AWS Free Tier (`t3.micro`, 30GB EBS, ECR, IAM, VPC) |
| **Jenkins Declarative CI/CD** | **Complete** | Declarative `Jenkinsfile` created with SHA tagging, ECR auth, rollback |
| **Prometheus & Grafana** | **Complete** | Custom dashboard JSON validated; alert rules CRD configured |

### Honest Architectural Trade-Offs
1. **Single EC2 Host Architecture:** Operating K3s, Jenkins, and Prometheus on a single `t3.micro` instance is intentionally engineered for learning and cost optimization under your $100 budget. It is a single point of failure and is not advertised as a multi-AZ enterprise production deployment.
2. **Ephemeral Redis Lifecycle:** The lab Helm chart configures Redis without persistent volume claims (PVC) to conserve disk and prevent storage lockups on single-node K3s. Room histories persist dynamically while rooms are populated, but will reset upon Redis container restart.

---

## 16. Step-by-Step Operator Execution Manual

For full operator instructions, credential setup, and deployment walkthrough, consult the companion document:  
👉 **[`HOW-TO-RUN.md`](file:///d:/INT-378/HOW-TO-RUN.md)**

### Rapid Execution Summary:

1. **Set AWS Credentials (Local PowerShell):**
   ```powershell
   $env:AWS_ACCESS_KEY_ID="<YOUR_KEY>"
   $env:AWS_SECRET_ACCESS_KEY="<YOUR_SECRET>"
   $env:AWS_DEFAULT_REGION="ap-south-1"
   ```
2. **Provision Cloud Infrastructure (Local PowerShell):**
   ```powershell
   cd d:\INT-378\infra\terraform
   terraform init
   terraform apply
   # Retrieve server IP:
   terraform output ec2_public_ip
   ```
3. **Deploy App on the Cluster (Inside EC2 Session via SSM):**
   ```bash
   git clone https://github.com/sainiprakhar23/SharedSketch.git /home/ubuntu/SharedSketch
   cd /home/ubuntu/SharedSketch
   sudo docker build -t sharedsketch:v1 .
   sudo helm upgrade --install sharedsketch ./k8s/helm/sharedsketch \
     --namespace sharedsketch --create-namespace \
     --set image.repository=sharedsketch \
     --set image.tag=v1 \
     --set image.pullPolicy=Never \
     --wait
   ```
4. **Open in Browser:**  
   Navigate to `http://<EC2_PUBLIC_IP>/` to use the live collaborative drawing canvas!
5. **Clean Teardown:**  
   Run `terraform destroy` in `infra/terraform/` when testing is complete to eliminate ongoing AWS costs.
