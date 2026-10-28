// Document tools (crop / resize / watermark, combine images, images to PDF,
// text compare) -> TEST server (Oracle Cloud VM, arm64), served at
// https://cropresizecompare.risegap.com (landing page + tools; the indexed
// host), plus https://crop.risegap.com and https://text-compare.risegap.com
// (same app, no landing; the text-compare host opens on the text compare tool).
// Same pipeline as risegap-admin.
//
// Jenkins only ships the source: the image (incl. the Angular build in the
// Dockerfile's node stage) is built ON the test VM, which is arm64 too and
// has plenty of RAM - the Jenkins box (1.8 GB, no swap) got OOM-killed
// running `ng build` itself. Then `docker run`, published on 127.0.0.1:8082
// only. The VM's host nginx terminates HTTPS on 443 and routes
// both hosts there (risegap-api repo: deploy/nginx-risegap.conf).
//
// Jenkins credentials: test-server-ssh-key (SSH, user ubuntu) and
// test-server-ip (Secret text: the VM's IP). The repo is public and Cloudflare
// hides the origin, so the IP stays out of it.
pipeline {
  agent any

  triggers {
    githubPush()
  }

  environment {
    DEPLOY_PATH = "/home/ubuntu/jar/jenkins/deploy"
    REMOTE_IP = credentials('test-server-ip')
    SSH_CRED_ID = "test-server-ssh-key"
    SSH_USER = "ubuntu"
    APP_NAME = "doc-watermark"
    IMAGE_NAME = "doc-watermark:latest"
    SRC_TAR = "doc-watermark-src.tar.gz"
    BUILD_DIR = "/home/ubuntu/build/doc-watermark"
    PORT = "8082"
    PUBLIC_URL = "https://cropresizecompare.risegap.com"
  }

  stages {
    stage('Test Server Guard') {
      when {
        anyOf {
          branch 'main'
          expression { env.GIT_BRANCH == 'origin/main' }
          triggeredBy 'UserIdCause'
        }
      }
      stages {
        stage('Prepare') {
          steps {
            checkout scm
          }
        }

        stage('Upload Source') {
          steps {
            sh "tar --exclude=.git --exclude=node_modules --exclude=dist --exclude=.angular -czf /tmp/${SRC_TAR} ."
            sshagent(credentials: ["${env.SSH_CRED_ID}"]) {
              sh "ssh -o StrictHostKeyChecking=no ${SSH_USER}@${REMOTE_IP} 'mkdir -p ${DEPLOY_PATH}'"
              sh "scp -o StrictHostKeyChecking=no /tmp/${SRC_TAR} ${SSH_USER}@${REMOTE_IP}:${DEPLOY_PATH}/${SRC_TAR}"
            }
            sh "rm -f /tmp/${SRC_TAR}"
          }
        }

        stage('Build & Deploy on Test Server') {
          steps {
            sshagent(credentials: ["${env.SSH_CRED_ID}"]) {
              sh """
              ssh -T -o StrictHostKeyChecking=no ${SSH_USER}@${REMOTE_IP} << EOF
                  set -e
                  rm -rf ${BUILD_DIR} && mkdir -p ${BUILD_DIR}
                  tar -xzf ${DEPLOY_PATH}/${SRC_TAR} -C ${BUILD_DIR}
                  rm -f ${DEPLOY_PATH}/${SRC_TAR}
                  docker build -t ${IMAGE_NAME} ${BUILD_DIR}
                  docker rm -f ${APP_NAME} || true
                  docker run -d \\
                      --name ${APP_NAME} \\
                      --restart unless-stopped \\
                      -p 127.0.0.1:${PORT}:8080 \\
                      ${IMAGE_NAME}
                  docker image prune -f
                  docker builder prune -f --filter until=72h
EOF
              """
            }
          }
        }

        stage('Health Check') {
          steps {
            script {
              sshagent(credentials: ["${env.SSH_CRED_ID}"]) {
                retry(5) {
                  sleep 5
                  def status = sh(script: "ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${SSH_USER}@${REMOTE_IP} \"curl -s --max-time 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:${PORT}/healthz\" || echo failed", returnStdout: true).trim()
                  if (status != '200') {
                    error "Document tools not healthy on the VM (HTTP ${status}). Check: docker logs ${APP_NAME}"
                  }
                }
              }
              // From outside, straight to the VM's 443 (Cloudflare challenges
              // this AWS IP; -k: Origin CA cert): covers the host nginx
              // server block of each host.
              for (host in ['cropresizecompare.risegap.com', 'crop.risegap.com', 'text-compare.risegap.com']) {
                def status = sh(script: "curl -sk --max-time 10 --resolve ${host}:443:${REMOTE_IP} -o /dev/null -w '%{http_code}' https://${host}/healthz || echo failed", returnStdout: true).trim()
                if (status != '200') {
                  unstable "https://${host} not served by ${REMOTE_IP}:443 (HTTP ${status}) - check the host nginx ${host} server block"
                }
              }
            }
          }
        }
      }
    }
  }

  post {
    failure { echo "Document tools deployment failed!" }
    success { echo "Document tools deployed: ${env.PUBLIC_URL} and https://text-compare.risegap.com" }
  }
}
