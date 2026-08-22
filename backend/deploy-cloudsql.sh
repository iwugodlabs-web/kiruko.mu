#!/bin/bash

# Set up environment variables
PROJECT_ID="kontokas"
SERVICE_NAME="ivor-backend-cloudsql"
REGION="us-central1"
REPOSITORY="ivor-repo"
IMAGE_NAME="$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/$SERVICE_NAME"
CLOUD_SQL_CONNECTION="kontokas:us-central1:ivor-postgres"

echo "🔧 Setting up Google Cloud and permissions..."
gcloud config set project $PROJECT_ID

# Enable required APIs
gcloud services enable sqladmin.googleapis.com
gcloud services enable run.googleapis.com

# Get the Cloud Run service account
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
SERVICE_ACCOUNT="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"

# Grant Cloud SQL Client role to the service account
echo "🔐 Setting up Cloud SQL permissions..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_ACCOUNT" \
    --role="roles/cloudsql.client"

echo "🔨 Building Cloud SQL image..."
docker build -f Dockerfile -t $IMAGE_NAME .

if [ $? -ne 0 ]; then
    echo "❌ Docker build failed!"
    exit 1
fi

echo "📤 Pushing image..."
docker push $IMAGE_NAME

echo "⬆️ Running database migrations and seeding inside the built image..."
docker run --rm \
    --add-host=cloudsqlproxy:127.0.0.1 \
    -e 'ENVIRONMENT=production' \
    -e 'CLOUD_SQL_CONNECTION_NAME=kontokas:us-central1:ivor-postgres' \
    -e 'DB_USER=postgres' \
    -e 'DB_PASSWORD=IvorApp2024!' \
    -e 'DB_NAME=ivorapp' \
    -e 'JWT_SECRET=951655c17ffe25fb545344a9442a6fd1' \
    -e 'JWT_ALGORITHM=HS256' \
    -e 'TIME_ZONE_LOCAL=Indian/Mauritius' \
    $IMAGE_NAME \
    python3 scripts/migrate_and_seed.py

if [ $? -ne 0 ]; then
        echo "❌ Database migration and seeding failed. Aborting deploy."
        exit 1
fi

echo "✅ Database migrations and seeding completed successfully."

echo "🚀 Deploying to Cloud Run with Cloud SQL..."
gcloud run deploy $SERVICE_NAME \
  --image $IMAGE_NAME \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --port 8080 \
  --memory 1Gi \
  --timeout 300 \
  --max-instances 10 \
  --add-cloudsql-instances $CLOUD_SQL_CONNECTION \
  --set-env-vars \
    "ENVIRONMENT=production,CLOUD_SQL_CONNECTION_NAME=$CLOUD_SQL_CONNECTION,DB_USER=postgres,DB_PASSWORD=IvorApp2024!,DB_NAME=ivorapp,JWT_SECRET=951655c17ffe25fb545344a9442a6fd1,JWT_ALGORITHM=HS256,TIME_ZONE_LOCAL=Indian/Mauritius"

# Get service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --platform managed --region $REGION --format 'value(status.url)')
echo "✅ Cloud SQL deployment complete!"
echo "🌐 API available at: $SERVICE_URL"
echo "🔗 Test the API: $SERVICE_URL/docs"
echo "💾 Database: Cloud SQL PostgreSQL"
echo "🔌 Connection: Unix socket (/cloudsql/$CLOUD_SQL_CONNECTION)"
echo ""
echo "📋 Testing endpoints:"
echo "  Health: curl $SERVICE_URL/"
echo "  Users:  curl $SERVICE_URL/user/users"
echo "  Docs:   $SERVICE_URL/docs"