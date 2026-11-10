pipeline {
  agent any
  options { timestamps() }
  environment {
    REGISTRY = 'ghcr.io/tesnimabrouk-55'
    TAG      = "${env.BUILD_NUMBER}"
    NS       = 'sos-app'
  }
  stages {
    stage('Tests') {
      steps {
        sh '''docker run --rm --volumes-from jenkins -w "$WORKSPACE" node:20-alpine \
          sh -c "npm ci --ignore-scripts && npm run build:shared && npm test --if-present"'''
      }
    }
    stage('Build des images') {
      steps {
        sh '''
          docker build -f infrastructure/docker/Dockerfile.frontend \
            -t $REGISTRY/sos-frontend:$TAG -t $REGISTRY/sos-frontend:latest .
          for pair in gateway:gateway auth:auth-service donor:donor-service hospital:hospital-service notification:notification-service; do
            img=${pair%%:*}; svc=${pair##*:}
            docker build -f infrastructure/docker/Dockerfile.service --build-arg SERVICE=$svc \
              -t $REGISTRY/sos-$img:$TAG -t $REGISTRY/sos-$img:latest .
          done
        '''
      }
    }
    stage('Push vers GHCR') {
      steps {
        withCredentials([usernamePassword(credentialsId: 'github-pat', usernameVariable: 'GH_USER', passwordVariable: 'GH_TOKEN')]) {
          sh '''
            echo "$GH_TOKEN" | docker login ghcr.io -u "$GH_USER" --password-stdin
            for img in frontend gateway auth donor hospital notification; do
              docker push --all-tags $REGISTRY/sos-$img
            done
          '''
        }
      }
    }
    stage('Déploiement Kubernetes') {
      steps {
        sh '''
          kubectl apply -f k8s/
          kubectl -n $NS set image deployment/frontend             frontend=$REGISTRY/sos-frontend:$TAG
          kubectl -n $NS set image deployment/gateway              gateway=$REGISTRY/sos-gateway:$TAG
          kubectl -n $NS set image deployment/auth-service         auth-service=$REGISTRY/sos-auth:$TAG
          kubectl -n $NS set image deployment/donor-service        donor-service=$REGISTRY/sos-donor:$TAG
          kubectl -n $NS set image deployment/hospital-service     hospital-service=$REGISTRY/sos-hospital:$TAG
          kubectl -n $NS set image deployment/notification-service notification-service=$REGISTRY/sos-notification:$TAG
          for d in frontend gateway auth-service donor-service hospital-service notification-service; do
            kubectl -n $NS rollout status deployment/$d --timeout=300s
          done
        '''
      }
    }
  }
  post { always { sh 'docker logout ghcr.io || true' } }
}
