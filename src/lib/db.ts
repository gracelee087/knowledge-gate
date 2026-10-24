// MongoDB Atlas: lecture cards and concept mentions with vectors, for incremental processing.
// Only public lecture data goes here; personal notes never do.
import '../lib/env.ts';
import dns from 'node:dns';
import { MongoClient } from 'mongodb';
import { need } from './env.ts';

// On some networks (a phone hotspot, 2026-10-24) Node's resolver sees only 127.0.0.1 and the Atlas SRV lookup fails.
if (dns.getServers().every(s => s === '127.0.0.1' || s === '::1')) dns.setServers(['8.8.8.8', '1.1.1.1']);

let client: MongoClient | null = null;
export async function db() {
  client ??= await new MongoClient(need('MONGODB_URI')).connect();
  return client.db('lecture_gate');
}
export const closeDb = () => client?.close();
