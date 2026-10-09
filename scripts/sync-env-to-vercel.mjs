#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

// Read .env file
const envContent = readFileSync('.env', 'utf-8');
const lines = envContent.split('\n');

// Parse environment variables
const envVars = [];
for (const line of lines) {
  const trimmed = line.trim();
  // Skip comments and empty lines
  if (!trimmed || trimmed.startsWith('#')) continue;
  
  // Parse key=value
  const eqIndex = trimmed.indexOf('=');
  if (eqIndex === -1) continue;
  
  const key = trimmed.substring(0, eqIndex).trim();
  const value = trimmed.substring(eqIndex + 1).trim();
  
  // Skip empty values
  if (!value) continue;
  
  envVars.push({ key, value });
}

console.log(`Found ${envVars.length} environment variables to sync`);

// Sync each variable to Vercel
for (const { key, value } of envVars) {
  try {
    console.log(`Syncing ${key}...`);
    
    // Check if variable already exists
    try {
      const currentOutput = execSync(`vercel env ls`, { encoding: 'utf-8' });
      if (currentOutput.includes(key)) {
        console.log(`  → ${key} already exists, removing first...`);
        execSync(`vercel env rm ${key} production --yes`, { encoding: 'utf-8' });
      }
    } catch (e) {
      // Variable doesn't exist, that's fine
    }
    
    // Add the variable
    const command = `vercel env add ${key} production --value "${value}"`;
    execSync(command, { encoding: 'utf-8' });
    console.log(`  ✓ ${key} synced successfully`);
  } catch (error) {
    console.error(`  ✗ Failed to sync ${key}:`, error.message);
    process.exit(1);
  }
}

console.log('\n✅ All environment variables synced successfully!');
