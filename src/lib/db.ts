// MongoDB Atlas: lecture cards and concept mentions with vectors, for incremental processing.
// Only public lecture data goes here; personal notes never do.
import '../lib/env.ts';
import { MongoClient } from 'mongodb';
import { need } from './env.ts';

let client: MongoClient | null = null;
export async function db() {
  client ??= await new MongoClient(need('MONGODB_URI')).connect();
  return client.db('lecture_gate');
}
export const closeDb = () => client?.close();
