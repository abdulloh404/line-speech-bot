#!/bin/bash

set -e

GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${GREEN}🚀 Pulling latest code from Git...${NC}"
git pull origin main --no-rebase

echo -e "${GREEN}🐳 Building and restarting Docker containers...${NC}"
docker compose up -d --build

echo -e "${GREEN}✅ Deployment completed successfully!${NC}"
