import axios from 'axios';
import { isFirebaseStaging } from '@/shared/auth-config';

/** Browser requests use the same-origin API adapters; credentials stay server-side. */
export const api = axios.create();
api.interceptors.request.use(config => {
 if(isFirebaseStaging() && !/^\/api\/teacher\/(organizations|courses(?:\/[0-9a-f-]{36})?)$/.test(config.url ?? '')) {
   throw new Error('This V2 workflow is awaiting Firebase/Supabase integration.');
 }
 return config;
});
