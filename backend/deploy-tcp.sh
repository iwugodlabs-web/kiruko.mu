

# TCP Connection deployment for Cloud SQL (fallback option)
PROJECT_ID="kontokas"
SERVICE_NAME="ivor-backend-tcp"
REGION="us-central1"
REPOSITORY="ivor-repo"
IMAGE_NAME="$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/$SERVICE_NAME"

echo "🔧 Setting up Google Cloud for TCP connection..."
gcloud config set project $PROJECT_ID

# Allow all IPs to connect to Cloud SQL (for TCP connection)
echo "🌐 Configuring Cloud SQL for public access..."
gcloud sql instances patch ivor-postgres \
    --authorized-networks 0.0.0.0/0

echo "🔨 Building TCP connection image..."
docker build -f Dockerfile -t $IMAGE_NAME .

if [ $? -ne 0 ]; then
    echo "❌ Docker build failed!"
    exit 1
fi

echo "📤 Pushing image..."
docker push $IMAGE_NAME

echo "⬆️ Running database migrations and seeding inside the built image..."
docker run --rm \
    -e 'ENVIRONMENT=development' \
    -e 'POSTGRES_USER=postgres' \
    -e 'POSTGRES_PASSWORD=IvorApp2024!' \
    -e 'POSTGRES_SERVER=136.114.194.181' \
    -e 'POSTGRES_PORT=5432' \
    -e 'POSTGRES_DB=ivorapp' \
    -e 'POSTGRES_SSLMODE=require' \
    -e 'JWT_SECRET=951655c17ffe25fb545344a9442a6fd1' \
    -e 'JWT_ALGORITHM=HS256' \
    -e 'TIME_ZONE_LOCAL=Indian/Mauritius' \
    $IMAGE_NAME \
    python3 scripts/migrate_and_seed.py

# Note: This runs both migrations and seeding in one step.
# The script first applies all pending migrations, then seeds the database with sector data.

if [ $? -ne 0 ]; then
        echo "❌ Database migration and seeding failed. Aborting deploy."
        exit 1
fi

echo "🚀 Deploying to Cloud Run with TCP connection..."
gcloud run deploy $SERVICE_NAME \
  --image $IMAGE_NAME \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --port 8080 \
  --memory 1Gi \
  --timeout 300 \
  --max-instances 10 \
  --set-env-vars \
    "ENVIRONMENT=development,POSTGRES_USER=postgres,POSTGRES_PASSWORD=IvorApp2024!,POSTGRES_SERVER=136.114.194.181,POSTGRES_PORT=5432,POSTGRES_DB=ivorapp,POSTGRES_SSLMODE=require,JWT_SECRET=951655c17ffe25fb545344a9442a6fd1,JWT_ALGORITHM=HS256,TIME_ZONE_LOCAL=Indian/Mauritius"

# Get service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --platform managed --region $REGION --format 'value(status.url)')
echo "✅ TCP deployment complete!"
echo "🌐 API available at: $SERVICE_URL"
echo "🔗 Test the API: $SERVICE_URL/docs"
echo "💾 Database: Cloud SQL PostgreSQL (TCP connection)"
echo "🔌 Connection: TCP to 136.114.194.181:5432"
echo ""
echo "⚠️  Note: This uses public IP connection. For production, use socket connection instead."