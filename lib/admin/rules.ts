// Kdo smí co v administraci (čisté funkce, testy scripts/check-admin.mjs).
export type Actor={id:string;role:string;owner:boolean};
export const ADMIN_ACTIONS=['approve','block','unblock','role_admin','role_member'] as const;
export type AdminAction=typeof ADMIN_ACTIONS[number];
export const isAdmin=(a:Actor)=>a.owner||a.role==='admin';
export function canDo(actor:Actor,action:AdminAction,target:{isOwner:boolean;memberId:string|null}):string|null{
 if(!isAdmin(actor))return 'Na tohle nemáš oprávnění.';
 if(action==='approve')return null;
 if(target.isOwner)return 'Vlastníka nelze blokovat ani měnit jeho roli.';
 if(target.memberId&&target.memberId===actor.id)return 'Sám sebe zablokovat ani měnit si roli nemůžeš.';
 if(action==='role_admin'||action==='role_member'){if(!actor.owner)return 'Role může měnit jen vlastník.';if(!target.memberId)return 'Uživatel se ještě nepřihlásil.'}
 return null;
}
export function personStatus(p:{approved:number;blocked:number;isOwner:boolean}){return p.isOwner?'owner' as const:Number(p.blocked)?'blocked' as const:Number(p.approved)?'approved' as const:'pending' as const}
// verze EA pod 1.1.0 (svíčky pro graf posílá až 1.1)
export function isOldEa(v:string|null){const m=(v||'').match(/^(\d+)\.(\d+)/);if(!m)return true;const [a,b]=[Number(m[1]),Number(m[2])];return a<1||(a===1&&b<1)}
