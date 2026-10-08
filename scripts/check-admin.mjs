// Kontrola pravidel administrace: node --experimental-strip-types scripts/check-admin.mjs
import {canDo,isAdmin,personStatus,isOldEa,ADMIN_ACTIONS} from '../lib/admin/rules.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const owner={id:'g:1',role:'admin',owner:true},admin={id:'g:2',role:'admin',owner:false},member={id:'g:3',role:'member',owner:false};
const t=(memberId,isOwner=false)=>({memberId,isOwner});
check('akce',ADMIN_ACTIONS.join()==='approve,block,unblock,role_admin,role_member');
check('isAdmin',isAdmin(owner)&&isAdmin(admin)&&!isAdmin(member)&&isAdmin({id:'x',role:'member',owner:true}));
check('člen nesmí nic',ADMIN_ACTIONS.every(a=>canDo(member,a,t('g:9'))==='Na tohle nemáš oprávnění.'));
check('admin schválí a blokuje',canDo(admin,'approve',t(null))===null&&canDo(admin,'block',t('g:9'))===null&&canDo(admin,'unblock',t('g:9'))===null);
check('admin nemění role',canDo(admin,'role_admin',t('g:9'))==='Role může měnit jen vlastník.'&&canDo(admin,'role_member',t('g:9'))==='Role může měnit jen vlastník.');
check('vlastník mění role',canDo(owner,'role_admin',t('g:9'))===null&&canDo(owner,'role_member',t('g:9'))===null);
check('role jen přihlášenému',canDo(owner,'role_admin',t(null))==='Uživatel se ještě nepřihlásil.');
check('vlastníka nelze blokovat ani měnit',['block','unblock','role_admin','role_member'].every(a=>canDo(admin,a,t('g:1',true))==='Vlastníka nelze blokovat ani měnit jeho roli.'));
check('schválení vlastníka nevadí',canDo(admin,'approve',t('g:1',true))===null);
check('sám sebe ne',canDo(admin,'block',t('g:2'))==='Sám sebe zablokovat ani měnit si roli nemůžeš.'&&canDo(owner,'role_member',t('g:1',true))!==null);
check('stav',personStatus({approved:0,blocked:0,isOwner:false})==='pending'&&personStatus({approved:1,blocked:0,isOwner:false})==='approved'&&personStatus({approved:1,blocked:1,isOwner:false})==='blocked'&&personStatus({approved:0,blocked:1,isOwner:false})==='blocked'&&personStatus({approved:0,blocked:0,isOwner:true})==='owner');
check('stará verze EA',isOldEa('1.0.0')&&isOldEa('1.0.9')&&!isOldEa('1.1.0')&&!isOldEa('1.2.0')&&!isOldEa('2.0.0')&&isOldEa('')&&isOldEa(null)&&!isOldEa('1.10.0'));

if(fails.length){console.log(`\n${fails.length} selhalo`);process.exit(1)}console.log('\nvše ok');
