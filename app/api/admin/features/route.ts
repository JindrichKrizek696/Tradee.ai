import {failed} from '@/lib/server';
import {adminUser} from '@/lib/admin/http';
import features from '@/data/features.json';
// Stav funkcí pro interní QA (jen správce). Udržuje se ručně v data/features.json.
export async function GET(req:Request){try{const u=await adminUser(req);if(u instanceof Response)return u;return Response.json(features,{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
