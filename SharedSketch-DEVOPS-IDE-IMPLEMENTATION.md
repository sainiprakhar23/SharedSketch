# SharedSketch — DevOps, AWS, Kubernetes, CI/CD & Monitoring Implementation Brief

> **Purpose:** Give this file to your IDE coding agent while the `sainiprakhar23/SharedSketch` repository is open. The agent must inspect the real code, implement the infrastructure in controlled phases, provide exact commands, validate each phase, and stop for confirmation at each gate.
>
> **Working rule:** Do not try to generate the entire platform in one pass. Complete one phase, show changed files and test evidence, explain the next commands, and wait for my explicit approval before proceeding to the next phase.

---

## 1. Role and mission

Act as a senior DevOps/SRE engineer and hands-on guide. Upgrade this existing project into a working, demonstrable delivery platform using:

- Docker for reproducible application images.
- Kubernetes on an AWS EC2-hosted K3s cluster for deployment and pod management.
- Terraform for reproducible AWS infrastructure.
- Jenkins for CI/CD.
- GitHub push events to trigger the pipeline automatically.
- Amazon ECR for versioned container images.
- Prometheus for application and Kubernetes metrics scraping.
- Grafana for dashboards and alert visibility.
- Redis-backed shared room state and the Socket.IO Redis adapter so multi-pod collaboration works correctly before enabling horizontal scaling.

This is a learning/lab deployment unless I explicitly request production hardening. Clearly identify lab-only trade-offs; do not describe a single EC2 host as highly available or production-grade.

## 2. Repository context you must verify before changing anything

Repository: `https://github.com/sainiprakhar23/SharedSketch`

Existing project notes and architecture documentation indicate:

- SharedSketch is a real-time collaborative drawing canvas.
- Frontend: vanilla HTML, CSS, and JavaScript using the HTML5 Canvas API.
- Backend: Node.js, Express, and Socket.IO.
- Root `package.json` names the app `collaborative-canvas`, starts `server/server.js` using `npm start`, and depends on `cors`, `dotenv`, `express`, and `socket.io`.
- Express serves static files from `server/public` and documents `/`, `/canvas`, `/health`, and `/stats` routes.
- The live room state—users, drawing history, and per-user redo stacks—is currently stored in an in-memory `Map`. It is lost on process restart and is not shared between Node processes.
- The repository contains both `client/` and `server/public/` copies of frontend assets. The project notes warn that these copies have drifted and that the server serves `server/public/`, not the standalone `client/` folder.
- Existing notes warn about hardcoded/stale Socket.IO server URLs in the served client assets.

These notes may be outdated. **Verify every point against the current files.** Inspect `README.md`, `ARCHITECTURE.md`, `PROJECT-UNDERSTANDING.md`, `package.json`, `package-lock.json`, `server/server.js`, and all relevant frontend files before editing. Never assume a file's contents based only on this brief.

### First tasks in Phase 0

1. Run `git status --short --branch` and inspect the current branch and local modifications. Never overwrite uncommitted user work.
2. Map the repository, runtime entry point, static asset serving path, Socket.IO connection setup, health routes, CORS configuration, and available npm scripts.
3. Compare duplicated assets in `client/` and `server/public/`. Report the exact differences before resolving them. Choose and document a single source of truth; do not blindly copy one directory over the other.
4. Check for `.env`, credentials, tokens, private keys, generated Terraform state, or other sensitive files. Do not print secret values or commit them.
5. Establish a working baseline by installing dependencies and running the app/tests, where possible. Record current failures separately from failures caused by your changes.
6. Present a short architecture audit, proposed file tree, assumptions, unknowns, and Phase 0 validation evidence. **Do not begin Phase 1 until I approve.**

## 3. Target architecture

Use this as the intended design, refining details only after inspecting the repository and explaining the reason for changes.

```text
Developer pushes to GitHub main
              |
              v
GitHub webhook (HTTPS) or explicitly chosen SCM-polling fallback
              |
              v
Jenkins pipeline on AWS EC2
  1. Checkout commit
  2. Test / lint / security checks
  3. Build immutable container image
  4. Authenticate to Amazon ECR through EC2 IAM role
  5. Push image tagged with Git commit SHA
  6. Helm deploy to K3s
  7. Wait for rollout + smoke-test health endpoint
  8. Roll back failed release and mark build failed
              |
              v
Amazon ECR ----> Kubernetes/K3s on EC2
                       |
             +---------+----------+
             |                    |
             v                    v
     SharedSketch pods       Redis service
     Express + Socket.IO     Shared room state
             |                    |
             +---- Redis adapter -+
                       |
                       v
            Prometheus scrape /metrics
                       |
                       v
                     Grafana
```

### Important architecture decisions

- **Do not use an EKS cluster by default.** The requested learning target is Kubernetes hosted on EC2, so use K3s on Ubuntu EC2 unless a technical blocker is found. Explain the difference between self-managed K3s and managed EKS, including operational responsibility.
- **Do not claim that multiple Node replicas work merely because the Kubernetes Deployment has `replicas: 2`.** Socket.IO broadcasts and room/drawing state must work across processes.
- Use the Socket.IO Redis adapter for cross-instance Socket.IO broadcasts and implement shared room state in Redis (including drawing history, room metadata, users/presence as appropriate, and undo/redo semantics). The adapter alone does **not** move the application's existing in-memory `Map` into Redis.
- Use safe, ordered/atomic state mutations for high-frequency drawing events. Preserve the existing client/server event contract where possible. Add tests for concurrent drawing, joining an existing room through a different app replica, undo/redo, clear, disconnect, room cleanup, and Redis-unavailable behavior.
- Only enable autoscaling above one application replica after integration tests demonstrate that users connected to different pods see consistent state. If the agent cannot complete or prove this, keep production values at one replica and plainly label multi-replica scaling incomplete. Do not fake this acceptance criterion.
- Start with one EC2 instance for cost-aware learning, but clearly state that it is a single point of failure and all components compete for CPU/RAM/disk. Use configurable instance type/region variables. A memory-constrained instance can OOM during Docker builds or when Jenkins, K3s, Prometheus, and Grafana run together; size resources deliberately, and report current AWS pricing only after checking an authoritative pricing source.
- Keep Prometheus, Grafana, Redis, and Jenkins administrative interfaces off unrestricted public ingress. Access dashboards with `kubectl port-forward` or a deliberately configured authenticated, HTTPS-protected route.
- Prefer GitHub webhook over HTTPS. If I do not have a domain/TLS endpoint available, explain the trade-off and use Jenkins SCM polling as the safe functional fallback rather than exposing Jenkins' raw port to the whole Internet. Do not configure webhook and polling simultaneously unless duplicate build handling is deliberate.

## 4. Required repository layout

Create or adjust a layout close to the following, without moving existing source files unnecessarily:

```text
.
├── Dockerfile
├── .dockerignore
├── .env.example                 # placeholder names only; no real secrets
├── Jenkinsfile
├── package.json                 # preserve dependencies; add useful scripts/tests
├── package-lock.json            # keep in sync with package.json
├── README.md                    # local run + Docker + deployment instructions
├── DEVOPS-RUNBOOK.md             # commands, architecture, operations, rollback
├── client/                      # source assets if confirmed as canonical
├── server/
│   ├── server.js
│   ├── public/                  # generated/copied build assets if this remains the serving path
│   └── ...
├── tests/                        # health, Socket.IO, room-state and scaling tests
├── monitoring/
│   ├── grafana-dashboards/
│   └── prometheus-rules/         # if needed
├── k8s/
│   └── helm/sharedsketch/        # Chart.yaml, values.yaml, templates
└── infra/
    └── terraform/                # providers, variables, main/resources, outputs
```

Add other files only when they serve a concrete purpose. Ignore `.env`, `node_modules/`, `.terraform/`, Terraform state and plans, kubeconfigs, generated secrets, logs, and local artifacts in Git. Never commit a real secret, private key, `terraform.tfstate`, or kubeconfig.

## 5. Non-negotiable safety and implementation rules

1. **Never ask me to paste AWS access keys, passwords, GitHub PATs, Docker credentials, private SSH keys, kubeconfigs, or `.env` secrets into the IDE prompt, source code, Markdown, or chat.** Tell me exactly where each credential belongs in the relevant credential manager or local shell, using placeholders in examples.
2. Prefer the AWS CLI's configured profile/SSO for local Terraform use and an EC2 instance profile for AWS calls from Jenkins. Use least-privilege IAM permissions for only the required ECR repository and SSM actions. Do not put static AWS keys in Jenkinsfiles, Terraform variables, user data, or GitHub files.
3. Store a GitHub webhook secret and any required GitHub credentials in Jenkins Credentials. Public repository checkout may not require a GitHub PAT. Never echo secrets into console logs.
4. Do not expose SSH, Jenkins, Grafana, Prometheus, Redis, or Kubernetes API ports to `0.0.0.0/0`. Public application traffic may use 80/443. Restrict any SSH source to my explicit IP CIDR if SSH is used. Prefer AWS Systems Manager Session Manager and an instance role where feasible.
5. Do not use `latest` as the deployed application tag. Use immutable commit-SHA image tags and record the deployed image in the release output.
6. Do not run `terraform apply`, `terraform destroy`, destructive `kubectl` commands, security-group broadening, resource deletion, or commands likely to incur significant cost without first showing the exact command, explaining impact/cost, and asking me for explicit approval.
7. Do not silently replace existing AWS resources, VPCs, security groups, DNS records, files, or local changes. Run `terraform plan` and inspect proposed replacements/destroys.
8. Do not disable TLS verification, use privileged containers without justification, run the application as root, store secrets in image layers, or bake credentials into Docker images.
9. Use supported, currently maintained software versions. Before pinning installation commands for Jenkins, K3s, Helm, Terraform, or monitoring charts, check their current official installation instructions. Avoid inventing version numbers or stale apt repository steps.
10. Preserve the application's features and Socket.IO event names unless a change is necessary. If a protocol change is required, update the frontend/backend together and add a compatibility note.
11. All generated shell commands must be labeled by environment, for example `[Windows PowerShell — local]`, `[Ubuntu EC2 — via SSM/SSH]`, or `[Kubernetes context]`. Because local development may run on Windows, do not silently give Bash-only commands as if they were PowerShell commands.
12. Do not dump the whole project or 100 commands at once. Give only the commands for the current task, explain why each matters, state expected output, and wait for my confirmation before the next phase.

## 6. Phase-by-phase implementation plan

### Phase 0 — Inspect and baseline (no infrastructure changes)

- Audit project structure, scripts, dependencies, health checks, static assets and Socket.IO URL selection.
- Test `npm ci`, `npm start`, HTTP routes and a real Socket.IO connection.
- Verify whether the documented `/health` route returns a meaningful status and whether `/stats` leaks information or is intended only for debugging.
- Identify hardcoded Render/localhost URLs and any asset-copy drift.
- Produce a concise report: current state, known defects, exact proposed file changes, risks, and baseline test output.
- **Gate:** stop and await my approval.

### Phase 1 — Make the application deployment-ready

Inspect actual code and make the smallest safe changes needed to:

- Read the HTTP listen port from `process.env.PORT` with a sensible development default, and bind in a container-compatible way (typically `0.0.0.0`).
- Use a same-origin Socket.IO connection where possible; eliminate hardcoded old hosting URLs. Keep local development configurable without putting an environment-specific production URL in source code.
- Make one frontend asset directory the documented source of truth. Add a deterministic build/copy step only after comparing the folders and resolving conflicts deliberately.
- Keep `/health` lightweight for liveness. Add `/ready` for readiness, including dependency checks if Redis becomes required. Return non-sensitive status only.
- Add Prometheus instrumentation using `prom-client` (or a justified maintained alternative): process metrics, HTTP request count and duration, Socket.IO connection count, room count, and selected event/error counters.
- Serve `/metrics` for in-cluster Prometheus scraping. Do not include drawing data, user names, room IDs, tokens, or unbounded/high-cardinality labels in metrics.
- Keep `/metrics` internal to the cluster or otherwise protected; do not publish it as an unauthenticated public route.
- Make `/stats` safe or keep it internal; do not accidentally expose sensitive room/user information.
- Add automated tests with Node's test runner or the project's suitable test framework. Add tests for health/readiness, Socket.IO joining/drawing, and core room behavior. Add required development dependencies carefully and update the lockfile.
- Add a real `npm test` script. Fix the current dev script if it points at a nonexistent path, but do not break `npm start`.
- Add graceful shutdown handling that stops accepting new traffic and closes Socket.IO/Redis connections cleanly.
- Write/update README instructions.

Run tests and local smoke checks. Show changed files and actual results, not just claims. **Gate:** wait for approval.

### Phase 2 — Redis shared state and multi-replica correctness

This phase is mandatory before enabling multi-replica deployment.

- Add Redis support using maintained Node Redis tooling and `@socket.io/redis-adapter` or a compatible maintained adapter. Use separate pub/sub connections as required by the selected adapter's official instructions.
- Refactor room operations behind a clear room-state/storage module instead of accessing the original in-memory `Map` from unrelated event handlers.
- Store/read shared room metadata, drawing history, redo state, and membership/presence in Redis as appropriate to existing behavior. Choose sensible key naming, TTL/cleanup behavior, and atomic operations. Avoid one giant unbounded key and avoid non-atomic read-modify-write sequences for events that can race.
- Preserve behavior for `join-room`, `draw`, `draw-line`, `cursor-move`, `undo`, `redo`, `clear-canvas`, disconnect, and room-empty cleanup. Verify the exact current event payloads before changing them.
- Ensure broadcasts reach users connected to different server processes through the Redis adapter. Understand the distinction: the Socket.IO adapter forwards broadcasts, while the application must separately share drawing/room data.
- Define startup/readiness behavior when Redis cannot be reached. Do not report ready while the shared-state dependency is unavailable if the app cannot function correctly.
- Add integration tests that intentionally connect clients to **different app instances** and confirm consistent shared state, event broadcast, undo/redo, and cleanup. Include concurrency and Redis failure tests to a reasonable learning-project level.
- Document that room state is ephemeral or persistent according to the chosen Redis setup. Do not claim durable drawing storage unless implemented and tested.

Start with one app replica while testing shared state. **Gate:** do not proceed to multi-pod autoscaling until the test evidence is green and I approve.

### Phase 3 — Containerize the application

Create a secure, reproducible Docker image:

- Use a maintained Node.js LTS base compatible with the verified project runtime.
- Use `npm ci`; keep the lockfile in sync. Install only runtime dependencies in the final image when possible.
- Run as a non-root user, use a small trusted base, set a working directory, expose the actual server port, and start via `npm start`.
- Include `.dockerignore` that excludes `node_modules`, `.git`, `.env*` except a safe example file, tests if they are not needed at runtime, Terraform artifacts, local logs, and credentials. Do not exclude assets required to serve the site.
- Add an image health check that works in the chosen base image, or rely on Kubernetes probes with a reasoned design.
- Do not bake `.env`, AWS credentials, GitHub secrets, or deployment configuration into the image.
- Test a clean local build, container startup, health endpoint, frontend static files, Socket.IO connection, restart, and shutdown.
- Pin by commit or release and show image size and vulnerability scan results when a scanner is available.

Provide the commands for local Docker build/run and cleanup, with a warning before any volume or data deletion. **Gate:** wait for approval.

### Phase 4 — Kubernetes manifests/Helm chart on K3s

Create a maintainable Helm chart (preferred over unstructured duplicated YAML) containing:

- SharedSketch Deployment, ClusterIP Service, configurable image repository/tag, environment settings, liveness/readiness probes, graceful termination, security context, resource requests/limits, and sensible rolling update settings.
- Redis deployment/service and configuration appropriate for this learning environment. Use a PVC only if it has a clear purpose; document the durability trade-off and EC2 disk dependency. Keep Redis internal-only.
- Ingress for application HTTP and Socket.IO traffic. Use the K3s ingress controller that actually exists on the host (often Traefik); verify its status before choosing an ingress class. Confirm WebSocket upgrades work through the ingress.
- HPA configured with resource requests and metrics-server available, but initially constrain replica settings until Phase 2 multi-instance tests prove correctness. Then enable a configurable `minReplicas`/`maxReplicas` range and CPU target.
- Use internal DNS/service names instead of public IPs for inter-pod communication. Do not use `hostNetwork` or `hostPort` unless there is a documented necessity.
- Do not expose Redis, Prometheus, Grafana, Jenkins, or the Kubernetes API via the public application Ingress.
- Add PodDisruptionBudget only if it has meaningful semantics for the actual replica count; do not add one-replica policies that prevent voluntary disruptions.
- Add Helm lint/template checks and render manifests to catch errors before deployment.

Commands must verify cluster status, nodes, pods, services, ingress, HPA metrics, and app health. Test scale up and down, then verify two real clients in the same room connected across different pods remain consistent. **Gate:** wait for approval.

### Phase 5 — AWS Terraform infrastructure

Create Terraform under `infra/terraform/`. Inspect local AWS setup first and avoid duplicating resources that already exist.

At minimum, manage the infrastructure required for a learning deployment:

- AWS provider and configurable region (default `ap-south-1` unless I choose another region).
- Configurable Ubuntu LTS EC2 AMI lookup using a maintained AWS/SSM source where appropriate; never hard-code an old AMI ID.
- Configurable instance type (choose a RAM/CPU size adequate for Jenkins + K3s + Prometheus/Grafana; present the cost trade-off before creation).
- Required networking: a clearly defined VPC/subnet/route or a documented and verified existing network, public application path, and correct outbound access for package installation and ECR/SSM.
- Security group with least-privilege inbound rules. Allow only required public app/webhook TLS ports, and SSH only from an explicitly configured trusted CIDR if SSH is enabled. Do not expose Jenkins' raw port, Redis, Grafana, Prometheus, or the K8s API to the world.
- EC2 instance role/profile with SSM permissions and least-privilege ECR push/pull permissions scoped to the required repository. Use the instance profile for Jenkins' AWS calls.
- ECR repository for versioned application images, image scanning if supported/configured, and a lifecycle policy to prevent unlimited old-image accumulation.
- Encrypted EBS, IMDSv2 required, useful resource tags, and stable outputs (instance ID, public address/DNS as appropriate, ECR URL, region).
- Reproducible host bootstrap for Docker, K3s, Jenkins, Helm, AWS CLI (or other required tools), and monitoring prerequisites. Keep bootstrap scripts reviewable and idempotent. Do not place credentials in Terraform user data.
- A way to manage Jenkins/EC2 operations securely. Prefer SSM; if Jenkins is on the same host for this budget-constrained lab, document the single-host security/availability trade-offs. Do not call it production architecture.

Terraform rules:

- Include `variables.tf`, `outputs.tf`, clear descriptions, validation for risky inputs, and `.gitignore` for state, plans, crash logs and local variable files.
- Supply `.tfvars.example` with placeholders only; never commit actual IDs/secrets.
- `terraform fmt -check`, `terraform init`, and `terraform validate` must pass.
- Show `terraform plan` and explicitly review any create/update/replace/destroy actions before asking me to approve `terraform apply`.
- Do not execute apply or destroy automatically. Estimate likely ongoing costs using current official pricing only if checked; clarify that EC2, EBS, ECR data, and public IPv4/network traffic may incur charges.
- For a personal learning setup, local Terraform state may be acceptable temporarily but must stay ignored and backed up safely. If remote state is proposed, explain and provision its encryption, access control, and locking correctly before using it.

**Gate:** stop at the plan and wait for my explicit approval before creating paid AWS resources.

### Phase 6 — Jenkins + GitHub automation

Create a root-level `Jenkinsfile` using Declarative Pipeline. Keep it readable and robust.

Expected stages:

1. Checkout the exact triggering commit.
2. Validate required files/configuration.
3. Install dependencies reproducibly with `npm ci`.
4. Run automated tests and lint/static checks if configured.
5. Run a dependency/security check with a documented policy for warnings versus blocking failures.
6. Build the Docker image with immutable tag `${GIT_COMMIT}` or a short SHA.
7. Authenticate to ECR using the EC2 instance profile and AWS CLI; push the image to the exact ECR repository.
8. Run Helm lint/template checks.
9. Deploy the SHA-tagged image via Helm to the intended namespace/context.
10. Wait for `kubectl rollout status`, then smoke-test `/health` and at least one Socket.IO connection/handshake where feasible.
11. If deployment or smoke tests fail, attempt a controlled Helm rollback to the last successful release, capture diagnostics, and fail the build. Do not hide the original failure if rollback also fails.
12. Archive useful test output and show the deployed commit and image tag. Never archive secret-bearing files.

Trigger behavior:

- Preferred: GitHub repository webhook over HTTPS to Jenkins, using a maintained Jenkins GitHub integration/plugin and the correct `/github-webhook/` endpoint supported by that plugin. Document the exact GitHub webhook content type, event choice, secret setup, TLS requirement, and Jenkins plugin configuration.
- Do not expose the raw Jenkins admin port to `0.0.0.0/0`. Use a domain and TLS-protected reverse proxy/webhook endpoint with authentication, or use SCM polling as the documented fallback if no public HTTPS endpoint/domain exists. If fallback polling is used, configure only that trigger to avoid duplicate builds.
- Automatically run validation for pull requests where feasible, but only deploy from the intended trusted branch (normally `main`) after tests pass. Never deploy untrusted fork PR code with access to production credentials.
- Do not rely on GitHub Actions as the main deployment orchestrator; Jenkins is the requested pipeline engine. GitHub is the source control/event source.
- Add a manual rollback procedure and explain how to redeploy a previous immutable image.

Credentials:

- AWS: EC2 instance profile / least-privilege IAM role; no static AWS keys in Jenkins credentials unless there is a documented unavoidable exception.
- GitHub: no PAT unless private checkout or API usage requires it. If needed, store it in Jenkins Credentials.
- Webhook: store the webhook secret in Jenkins configuration/credentials and validate it according to the selected plugin.
- App: there are currently no database credentials expected by the project. Only add Kubernetes Secrets if a real secret is introduced later; do not invent dummy secrets.

**Gate:** validate Jenkinsfile syntax/configuration and local pipeline steps before turning on automatic deploys. Wait for approval before changing the live GitHub webhook or triggering a cloud deployment.

### Phase 7 — Prometheus and Grafana

Install monitoring through Helm using a maintained chart such as `kube-prometheus-stack`, after checking the current official chart documentation and cluster compatibility.

- Configure Prometheus discovery/scraping of the SharedSketch service's `/metrics` endpoint, preferably via a `ServiceMonitor` when the relevant CRD is installed. Verify the label selectors match the actual Helm chart labels.
- Include app process/HTTP metrics, Socket.IO active connection counters, room count, event counts/errors, and Redis health/dependency metrics where practical.
- Do not use `roomId`, user IDs/names, drawing payloads or other unbounded values as metric labels.
- Provision a useful Grafana dashboard with panels for HTTP request rate/error rate/latency, Node process memory/CPU, active socket connections, room count, drawing/socket events, Redis status, pod restarts, pod CPU/memory, HPA desired/current replicas, and deployment health where metrics are available.
- Add a small set of sensible Prometheus alert rules if appropriate (app unavailable, repeated pod restarts, sustained high CPU/memory, Redis unavailable). Explain where alerts can be viewed and that email/chat delivery needs separately configured notification credentials.
- Keep monitoring services internal. Prefer port-forward commands such as `kubectl port-forward` for access; never add public ingress for Grafana or Prometheus by default.
- Verify the Prometheus target is `UP`, query a known application metric, import/load the dashboard, and explain how to stop a port-forward.

**Gate:** show actual scrape and dashboard verification, then wait for approval.

### Phase 8 — End-to-end acceptance and runbook

Perform the following only after the relevant phases are approved:

- Push a harmless test commit to the trusted branch and verify a new Jenkins build starts automatically through the selected webhook/polling method.
- Verify the pipeline checks out that commit, runs tests, builds and pushes a new immutable image, deploys it, and passes smoke checks.
- Open the deployed application from a browser using the correct URL. Confirm frontend assets load and there are no stale hardcoded API/socket URLs.
- Use two separate clients in the same room and verify drawing, cursors, joining existing history, undo/redo, clear, and disconnect behavior.
- Confirm events/state remain consistent when connected clients land on different app pods. Demonstrate a scale-up and scale-down without claiming persistence beyond what Redis actually provides.
- Verify health/readiness, pod rollouts, HPA metrics, Prometheus scrape status, Grafana data, and the rollback path.
- Verify that secret-bearing endpoints and dashboards are not public and that no secrets were added to Git history.
- Produce `DEVOPS-RUNBOOK.md` with prerequisites, architecture, exact setup commands, AWS cost/deletion warnings, Jenkins/GitHub configuration, common errors, dashboard access, scale test, deploy/rollback procedure, and safe teardown instructions.
- Final report must distinguish **implemented**, **tested**, **not tested**, and **known limitations**. Provide evidence from command output, not just “done”.

## 7. Operational command style

For every phase, respond using this compact format:

1. **Goal** — what this step accomplishes and why it is needed.
2. **Inspect first** — read-only commands, where applicable.
3. **Commands** — exact commands for the correct environment (Windows PowerShell locally; Ubuntu via SSM/SSH on the EC2 host; or Kubernetes context). Use placeholders such as `<AWS_PROFILE>`, `<REGION>`, `<ECR_URI>`, `<YOUR_DOMAIN>`, and `<TRUSTED_IP_CIDR>` where I must fill values.
4. **Expected result** — what successful output/behavior looks like.
5. **Troubleshooting** — one or two likely errors and safe diagnostics.
6. **Validation evidence** — tests actually run and their result.
7. **Files changed** — list files and important decisions.
8. **Approval gate** — ask me to confirm the phase before proceeding.

Do not invent success or say a command passed without running it or seeing its output. If the IDE cannot execute shell commands, show the commands for me to run and ask me to paste only non-secret output. Redact any secrets if output unexpectedly contains them.

## 8. Definition of done

This project is not complete merely because Docker builds or a Pod reaches `Running`. It is complete when all relevant checks pass:

- [ ] Existing SharedSketch functionality remains operational.
- [ ] A repeatable Docker build runs the app as non-root and does not contain secrets.
- [ ] Terraform validates and its plan has been reviewed before apply.
- [ ] A real EC2 K3s cluster can pull from ECR and run the app.
- [ ] Jenkins automatically reacts to a trusted GitHub change using the chosen HTTPS webhook or clearly documented polling fallback.
- [ ] Jenkins tests, builds, tags, pushes, deploys, smoke-tests, and reports failures correctly.
- [ ] Deployment uses immutable SHA tags, never `latest`.
- [ ] Redis adapter and shared state have been implemented and tested before deploying multiple application replicas.
- [ ] HPA metrics work and scaling does not split collaborative room state.
- [ ] Prometheus scrapes application metrics and Grafana displays meaningful dashboards.
- [ ] Internal tools and AWS access are not unnecessarily exposed.
- [ ] Rollback and safe teardown steps are documented and verified as far as practical.
- [ ] Actual tested behavior, trade-offs, costs, and unverified assumptions are stated honestly.

## 9. Start now

Start with **Phase 0 only**. Inspect the actual open repository and local environment, do the read-only audit and baseline checks, then present findings and wait for my approval. Do not start writing Dockerfiles, Terraform, Kubernetes manifests, Jenkins pipelines, or AWS resources until Phase 0 is approved.
