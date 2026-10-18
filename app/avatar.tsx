import {initials} from '@/lib/profile/rules';
import './avatar.css';
// Kolečko avataru: profilová fotka, jinak iniciály na barvě z profilu (bez barvy modrý přechod z loga). Velikost určuje rodič.
export function Avatar({name,src,color,className=''}:{name:string;src?:string|null;color?:string|null;className?:string}){
 return src?<img className={'av '+className} src={src} alt="" draggable={false}/>:<span className={'av '+className} style={color?{background:color}:undefined} aria-hidden="true">{initials(name)}</span>;
}
