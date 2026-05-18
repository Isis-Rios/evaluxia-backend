import mongoose from 'mongoose';
import { env } from '@/config/env';

/**
 * Connects to MongoDB via Mongoose.
 * Retries on failure and logs connection lifecycle events.
 */
export async function connectToDatabase(): Promise<void> {
  mongoose.connection.on('connected', () => {
    console.log('✅  MongoDB connected successfully');
  });

  mongoose.connection.on('error', (err: Error) => {
    console.error('❌  MongoDB connection error:', err.message);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('⚠️   MongoDB disconnected');
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await mongoose.connection.close();
    console.log('🔌  MongoDB connection closed due to app termination');
    process.exit(0);
  });

  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
  });
}
