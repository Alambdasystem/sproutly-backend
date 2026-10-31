import {mkdirSync,readFileSync,realpathSync,lstatSync} from 'node:fs';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
const inside=(root,path)=>{const r=relative(root,path);return r===''||(!r.startsWith('..')&&!isAbsolute(r))};
export function requireMountedStorage({dbPath,mountPath,backupDir,mountInfo}={}){
 if(!mountPath)return{persistent:false};
 const mount=resolve(mountPath),database=resolve(dbPath);
 if(!inside(mount,database)||database===mount)throw new Error('DATABASE_PATH must be a file under the persistent mount.');
 if(backupDir&&!inside(mount,resolve(backupDir)))throw new Error('BACKUP_DIR must be under the persistent mount.');
 const info=mountInfo??readFileSync('/proc/self/mountinfo','utf8');
 const mounted=info.split('\n').some(line=>line.split(' ')[4]?.replace(/\\([0-7]{3})/g,(_,n)=>String.fromCharCode(parseInt(n,8)))===mount);
 if(!mounted)throw new Error('Required persistent disk is not mounted; refusing to write to ephemeral storage.');
 const realMount=realpathSync(mount);
 for(const directory of [dirname(database),...(backupDir?[resolve(backupDir)]:[])]){mkdirSync(directory,{recursive:true,mode:0o700});if(!inside(realMount,realpathSync(directory)))throw new Error('Storage directory resolves outside the persistent mount.');}
 try{if(lstatSync(database).isSymbolicLink())throw new Error('Database symlinks are not allowed.')}catch(e){if(e.code!=='ENOENT')throw e}
 return{persistent:true};
}
