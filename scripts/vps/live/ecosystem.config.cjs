module.exports = {
  apps: [{
    name: 'supertv-live',
    script: '/opt/supertv-live/server.mjs',
    cwd: '/opt/supertv-live',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '200M',
    min_uptime: '10s',
    max_restarts: 3,
    exp_backoff_restart_delay: 1000,
    kill_timeout: 6000,
    time: true,
    env: {
      NODE_ENV: 'production',
      LIVE_PORT: '8790',
      LIVE_API_BASE: 'http://127.0.0.1:4000',
      LIVE_CHANNEL_IDS: '450',
      LIVE_MAX_CHANNELS: '1',
      LIVE_IDLE_MS: '120000',
      LIVE_DIRECTORY: '/var/cache/supertv-live',
    },
  }],
};
