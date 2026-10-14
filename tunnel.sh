#!/bin/bash
while true; do
  echo "Starting ngrok tunnel..."
  ngrok http 3000
  echo "Tunnel stopped. Restarting in 3 seconds..."
  sleep 3
done
