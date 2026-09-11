# Upload to server
$SERVER = "root@2.26.112.123"
$REMOTE_DIR = "/opt/testing-bots"

Write-Host "Uploading files to $SERVER..." -ForegroundColor Green

# Upload backend
Write-Host "Uploading backend..." -ForegroundColor Yellow
scp -r .\backend "${SERVER}:${REMOTE_DIR}/"

# Upload frontend
Write-Host "Uploading frontend..." -ForegroundColor Yellow
scp -r .\frontend "${SERVER}:${REMOTE_DIR}/"

# Upload deploy script
Write-Host "Uploading deploy script..." -ForegroundColor Yellow
scp .\deploy.sh "${SERVER}:${REMOTE_DIR}/"

Write-Host ""
Write-Host "Upload complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. SSH to server: ssh ${SERVER}"
Write-Host "2. Run deploy: cd ${REMOTE_DIR} && chmod +x deploy.sh && ./deploy.sh"
