import * as THREE from 'three';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
export const poses={standing:{},walking:{leftLeg:.5,rightLeg:-.5,leftArm:-.5,rightArm:.5},sitting:{leftLeg:-1.3,rightLeg:-1.3},waving:{rightArm:2.7}};
export function dispose(object){object.traverse(item=>{item.geometry?.dispose();if(item.material)for(const m of [item.material].flat())m.dispose();});}
export function actor(object){
  const material=new THREE.MeshStandardMaterial({color:object.color||'#c3bbad',roughness:.8});
  let mesh;
  if(object.kind==='model')mesh=new THREE.Group();
  else if(object.kind==='character'){
    mesh=new THREE.Group();
    const part=(geometry,position)=>{const p=new THREE.Mesh(geometry,material);p.position.set(...position);mesh.add(p);return p;};
    part(new THREE.SphereGeometry(.23,20,12),[0,1.65,0]);part(new THREE.BoxGeometry(.5,.65,.25),[0,1.05,0]);
    for(const [joint,x,y,length] of [['leftLeg',-.16,.78,.75],['rightLeg',.16,.78,.75],['leftArm',-.35,1.35,.65],['rightArm',.35,1.35,.65]]){
      const pivot=new THREE.Group(),limb=new THREE.Mesh(new THREE.CylinderGeometry(.08,.08,length,12),material);limb.position.y=-length/2;pivot.add(limb);pivot.position.set(x,y,0);pivot.rotation.x=object.pose?.[joint]||0;pivot.userData.joint=joint;mesh.add(pivot);
    }
    if(object.body==='child'){const body=new THREE.Group();for(const part of [...mesh.children])body.add(part);body.scale.setScalar(.7);mesh.add(body);}
  }else mesh=new THREE.Mesh(object.kind==='sphere'?new THREE.SphereGeometry(.5,24,16):new THREE.BoxGeometry(1,1,1),material);
  mesh.position.set(...object.position);mesh.rotation.set(...object.rotation);mesh.scale.multiply(new THREE.Vector3(...object.scale));mesh.userData.id=object.id;return mesh;
}
export async function loadModel(resource,manager){
  const loader=resource.endsWith('.fbx')?new FBXLoader(manager):new OBJLoader(manager);
  const original=await loader.loadAsync('tugou-media://original/'+resource);
  const box=new THREE.Box3().setFromObject(original),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
  if(!Number.isFinite(size.length())||!size.length())throw Error('模型没有可渲染几何体');
  original.position.sub(center);const normalized=new THREE.Group();normalized.add(original);normalized.scale.setScalar(2/Math.max(size.x,size.y,size.z));return normalized;
}
export function modelInstance(original,color){const copy=clone(original);copy.traverse(obj=>{if(obj.geometry)obj.geometry=obj.geometry.clone();if(obj.material){const materials=[obj.material].flat().map(m=>{const next=m.clone();if(color&&next.color)next.color.set(color);return next;});obj.material=Array.isArray(obj.material)?materials:materials[0];}});return copy;}
