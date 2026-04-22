'use strict';

const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI || '';
const dbName = process.env.MONGODB_DB || 'ipcavnf';

async function connectMongo() {
  if (!uri) {
    throw new Error('MONGODB_URI não definido. Configura no ficheiro .env.');
  }

  if (mongoose.connection.readyState === 1) return mongoose.connection;

  await mongoose.connect(uri, {
    dbName,
    // Valores conservadores para app Node tradicional.
    maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE || '20', 10),
    minPoolSize: parseInt(process.env.MONGODB_MIN_POOL_SIZE || '5', 10),
    maxIdleTimeMS: parseInt(process.env.MONGODB_MAX_IDLE_MS || '300000', 10),
    connectTimeoutMS: parseInt(process.env.MONGODB_CONNECT_TIMEOUT_MS || '10000', 10),
    socketTimeoutMS: parseInt(process.env.MONGODB_SOCKET_TIMEOUT_MS || '30000', 10),
    serverSelectionTimeoutMS: parseInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || '5000', 10),
  });

  return mongoose.connection;
}

function getDb() {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('MongoDB ainda não está ligado. Chama connectMongo() no arranque.');
  }
  return mongoose.connection.db;
}

async function closeMongo() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
}

module.exports = {
  connectMongo,
  getDb,
  closeMongo,
};
