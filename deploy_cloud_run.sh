#!/bin/bash
set -e

SERVICE_NAME="skitch-modoki"
REGION="asia-northeast1"
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)

echo "Deploying ${SERVICE_NAME} to Google Cloud Run (Project: ${PROJECT_ID}, Region: ${REGION})..."

gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --region "${REGION}" \
  --allow-unauthenticated \
  --quiet

echo "Deployment finished successfully!"
