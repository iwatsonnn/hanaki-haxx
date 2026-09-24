require('dotenv').config();
const { startBot } = require('./helpers/bot');
const { claimSingleInstance } = require('./helpers/singleInstance');

// Two processes on one token double-log every admin action and run !hammer
// twice. Refuse to be the second.
claimSingleInstance(process.env.TOKEN, 'Haxxor');

startBot();
