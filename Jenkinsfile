// Declarative Jenkinsfile for SharedSketch
pipeline {
    agent any

    options {
        timeout(time: 20, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '15'))
        disableConcurrentBuilds()
    }

    parameters {
        string(name: 'AWS_REGION', defaultValue: 'ap-south-1', description: 'AWS Region for ECR and K3s')
        string(name: 'AWS_ACCOUNT_ID', defaultValue: '', description: 'AWS 12-digit Account ID (Optional if auto-resolved by EC2 profile)')
        string(name: 'ECR_REPO_NAME', defaultValue: 'sharedsketch', description: 'Amazon ECR repository name')
        string(name: 'K8S_NAMESPACE', defaultValue: 'sharedsketch', description: 'Kubernetes namespace for deployment')
        booleanParam(name: 'FORCE_DEPLOY', defaultValue: false, description: 'Force deploy regardless of branch')
    }

    environment {
        APP_NAME        = 'sharedsketch'
        HELM_CHART_PATH = 'k8s/helm/sharedsketch'
        IMAGE_TAG       = "${env.GIT_COMMIT ? env.GIT_COMMIT.take(8) : 'build-' + env.BUILD_NUMBER}"
    }

    triggers {
        // Preferred: GitHub webhook. Fallback: SCM polling every 10 minutes if no public domain exists
        pollSCM('H/10 * * * *')
    }

    stages {
        stage('Checkout & Environment Inspection') {
            steps {
                echo "=========================================="
                echo "Deploying Commit: ${env.GIT_COMMIT}"
                echo "Branch:           ${env.GIT_BRANCH}"
                echo "Target Image Tag: ${env.IMAGE_TAG}"
                echo "=========================================="
                sh '''
                    echo "Validating core toolchains on host..."
                    node --version
                    npm --version
                    docker --version
                    helm version
                    kubectl version --client=true
                '''
            }
        }

        stage('Install Dependencies') {
            steps {
                sh 'npm ci'
            }
        }

        stage('Automated Tests') {
            steps {
                echo "Executing automated integration & scaling tests..."
                sh 'npm test'
            }
        }

        stage('Security & Dependency Audit') {
            steps {
                echo "Running npm security audit..."
                // Report critical vulnerabilities without failing lab builds unless configured
                sh 'npm audit --audit-level=critical || true'
            }
        }

        stage('Build Immutable Docker Image') {
            steps {
                echo "Building container image with immutable tag: ${env.IMAGE_TAG}..."
                sh "docker build -t ${env.APP_NAME}:${env.IMAGE_TAG} ."
            }
        }

        stage('Authenticate & Push to Amazon ECR') {
            when {
                expression {
                    return env.BRANCH_NAME == 'main' || env.GIT_BRANCH == 'origin/main' || env.GIT_BRANCH == 'main' || params.FORCE_DEPLOY
                }
            }
            steps {
                sh '''
                    # Resolve Account ID dynamically via EC2 Instance Profile if not manually supplied
                    if [ -z "${AWS_ACCOUNT_ID}" ]; then
                        ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text)
                    else
                        ACCOUNT_ID="${AWS_ACCOUNT_ID}"
                    fi

                    ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
                    IMAGE_URI="${ECR_REGISTRY}/${ECR_REPO_NAME}:${IMAGE_TAG}"

                    echo "Logging into Amazon ECR ${ECR_REGISTRY} via IAM instance profile..."
                    aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${ECR_REGISTRY}"

                    echo "Tagging and pushing ${IMAGE_URI}..."
                    docker tag "${APP_NAME}:${IMAGE_TAG}" "${IMAGE_URI}"
                    docker push "${IMAGE_URI}"
                    
                    # Store ECR_REGISTRY for subsequent Helm stage
                    echo "${ECR_REGISTRY}" > .ecr_registry.tmp
                '''
            }
        }

        stage('Helm Lint & Manifest Verification') {
            steps {
                echo "Running Helm lint and dry-run template check..."
                sh """
                    helm lint ${env.HELM_CHART_PATH}
                    helm template ${env.APP_NAME} ${env.HELM_CHART_PATH} --set image.tag=${env.IMAGE_TAG} > /dev/null
                """
            }
        }

        stage('Deploy to K3s Cluster') {
            when {
                expression {
                    return env.BRANCH_NAME == 'main' || env.GIT_BRANCH == 'origin/main' || env.GIT_BRANCH == 'main' || params.FORCE_DEPLOY
                }
            }
            steps {
                sh '''
                    ECR_REGISTRY=$(cat .ecr_registry.tmp 2>/dev/null || echo "")
                    if [ -z "${ECR_REGISTRY}" ]; then
                        ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text)
                        ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
                    fi

                    echo "Deploying release to K3s namespace: ${K8S_NAMESPACE}..."
                    helm upgrade --install "${APP_NAME}" "${HELM_CHART_PATH}" \
                        --namespace "${K8S_NAMESPACE}" \
                        --create-namespace \
                        --set image.repository="${ECR_REGISTRY}/${ECR_REPO_NAME}" \
                        --set image.tag="${IMAGE_TAG}" \
                        --wait \
                        --timeout 5m
                '''
            }
        }

        stage('Smoke Test & Health Verification') {
            when {
                expression {
                    return env.BRANCH_NAME == 'main' || env.GIT_BRANCH == 'origin/main' || env.GIT_BRANCH == 'main' || params.FORCE_DEPLOY
                }
            }
            steps {
                sh '''
                    echo "Waiting for rollout to complete..."
                    kubectl rollout status deployment/${APP_NAME} -n "${K8S_NAMESPACE}" --timeout=120s

                    echo "Verifying /health probe..."
                    kubectl run curl-smoke-test --image=curlimages/curl --restart=Never --rm -i \
                        --namespace="${K8S_NAMESPACE}" \
                        --command -- curl -sf http://${APP_NAME}:3000/health

                    echo "Smoke tests passed successfully!"
                '''
            }
        }
    }

    post {
        failure {
            echo "Pipeline encountered a failure. Capturing cluster diagnostics and initiating safe rollback..."
            sh '''
                kubectl get pods -n "${K8S_NAMESPACE}" || true
                kubectl logs -n "${K8S_NAMESPACE}" -l app.kubernetes.io/name="${APP_NAME}" --tail=50 || true
                
                echo "Attempting Helm rollback to last stable revision..."
                helm rollback "${APP_NAME}" -n "${K8S_NAMESPACE}" || echo "Rollback skipped or failed."
            '''
        }
        always {
            sh '''
                rm -f .ecr_registry.tmp
                # Prune dangling intermediate build layers on host
                docker image prune -f --filter "until=24h" || true
            '''
        }
    }
}
