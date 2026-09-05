module.exports = {
  apps: [{
    name: 'bedrock-proxy',
    script: 'src/server.js',
    instances: 1,
    autorestart: true,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
    },
  }],
};
