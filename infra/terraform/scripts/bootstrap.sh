#!/bin/bash
set -euxo pipefail

# 0. Setup 4GB Swapfile to ensure stability on Free Tier (t2.micro / t3.micro - 1GB RAM)
if [ ! -f /swapfile ]; then
    fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    sysctl vm.swappiness=20
    echo 'vm.swappiness=20' >> /etc/sysctl.conf
fi

# Update and install core utilities
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    unzip \
    jq \
    git \
    openjdk-17-jdk-headless

# 1. Install AWS CLI v2
if ! command -v aws &> /dev/null; then
    curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "/tmp/awscliv2.zip"
    unzip -q /tmp/awscliv2.zip -d /tmp
    /tmp/aws/install
    rm -rf /tmp/aws /tmp/awscliv2.zip
fi

# 2. Install Docker CE
if ! command -v docker &> /dev/null; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc

    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin
    systemctl enable docker
    systemctl start docker
    usermod -aG docker ubuntu
fi

# 3. Install Helm v3
if ! command -v helm &> /dev/null; then
    curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
fi

# 4. Install K3s (Single-Node Kubernetes)
if ! command -v k3s &> /dev/null; then
    curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--write-kubeconfig-mode 644" sh -
    
    # Configure kubeconfig for ubuntu user
    mkdir -p /home/ubuntu/.kube
    cp /etc/rancher/k3s/k3s.yaml /home/ubuntu/.kube/config
    chown -R ubuntu:ubuntu /home/ubuntu/.kube
    chmod 600 /home/ubuntu/.kube/config
fi

# 5. Install Jenkins LTS with memory-optimized Java flags for Free Tier
if ! command -v jenkins &> /dev/null; then
    curl -fsSL https://pkg.jenkins.io/debian-stable/jenkins.io-2023.key | tee \
      /usr/share/keyrings/jenkins-keyring.asc > /dev/null

    echo deb [signed-by=/usr/share/keyrings/jenkins-keyring.asc] \
      https://pkg.jenkins.io/debian-stable binary/ | tee \
      /etc/apt/sources.list.d/jenkins.list > /dev/null

    apt-get update -y
    apt-get install -y jenkins

    # Configure Jenkins JVM memory limit to 512MB to stay within Free Tier RAM
    mkdir -p /etc/systemd/system/jenkins.service.d/
    cat <<'EOF' > /etc/systemd/system/jenkins.service.d/override.conf
[Service]
Environment="JAVA_OPTS=-Djava.awt.headless=true -Xms128m -Xmx512m"
EOF
    systemctl daemon-reload
    systemctl enable jenkins
    systemctl restart jenkins

    # Grant Jenkins access to Docker & Kubeconfig
    usermod -aG docker jenkins
    mkdir -p /var/lib/jenkins/.kube
    cp /etc/rancher/k3s/k3s.yaml /var/lib/jenkins/.kube/config
    chown -R jenkins:jenkins /var/lib/jenkins/.kube
    chmod 600 /var/lib/jenkins/.kube/config
    systemctl restart jenkins
fi

echo "SharedSketch Free-Tier host bootstrap completed successfully at $(date -u)"
