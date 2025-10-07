/*
 * File: MOS.js
 * Authors: Brandon Bryant & Randall Rinehart
 * Class: COSC4103 Computer Graphics
 * Assignment #5: Multi-Object: View-Based Interaction with Single Animation.
 * Due: 10/8/2025
 * Description:
 */

const Mat4 = {
	identity: () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
	multiply: (a,b) => {
		const r = new Array(16);
		for (let c=0;c<4;c++) for (let rI=0;rI<4;rI++) {
			r[c*4+rI] = a[0*4+rI]*b[c*4+0] + a[1*4+rI]*b[c*4+1] + a[2*4+rI]*b[c*4+2] + a[3*4+rI]*b[c*4+3];
		}
		return r;
	},
	translate: (tx,ty,tz)=>[1,0,0,0, 0,1,0,0, 0,0,1,0, tx,ty,tz,1],
	scale: (sx,sy,sz)=>[sx,0,0,0, 0,sy,0,0, 0,0,sz,0, 0,0,0,1],
	perspective: (fovy, aspect, near, far) => {
		const f = 1/Math.tan(fovy/2), nf = 1/(near - far);
		return [f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,(2*far*near)*nf,0];
	},
	lookAt: (eye,center,up)=>{
		const [ex,ey,ez]=eye,[cx,cy,cz]=center; let [ux,uy,uz]=up;
		let zx=ex-cx, zy=ey-cy, zz=ez-cz;
		let rl = 1/Math.hypot(zx,zy,zz); zx*=rl; zy*=rl; zz*=rl;
		let rx = uy*zz - uz*zy, ry = uz*zx - ux*zz, rz = ux*zy - uy*zx;
		rl = 1/Math.hypot(rx,ry,rz); rx*=rl; ry*=rl; rz*=rl;
		ux = zy*rz - zz*ry; uy = zz*rx - zx*rz; uz = zx*ry - zy*rx;
		return [rx,ux,zx,0, ry,uy,zy,0, rz,uz,zz,0, -(rx*ex+ry*ey+rz*ez), -(ux*ex+uy*ey+uz*ez), -(zx*ex+zy*ey+zz*ez),1];
	}
};

const canvas = document.getElementById('glcanvas');
const gl = canvas.getContext('webgl', {antialias:true});
if(!gl){ alert('WebGL not supported'); throw new Error('WebGL'); }

function resize(){
	const dpr = window.devicePixelRatio || 1;
	const w = canvas.clientWidth, h = canvas.clientHeight;
	if(canvas.width !== w*dpr || canvas.height !== h*dpr){
		canvas.width = w*dpr; canvas.height = h*dpr;
	}
	gl.viewport(0,0,canvas.width,canvas.height);
}
window.addEventListener('resize', resize); resize();

function compile(type, src){
	const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
	if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
	return s;
}
function link(vsSrc, fsSrc){
	const p = gl.createProgram();
	gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
	gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
	gl.linkProgram(p);
	if(!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
	return p;
}

const state = {
	programs:{},
	buffers:{},
	attribs:{},
	uniforms:{},
	sphere:{},
	grid:{},
	camera:{ azimuth:0.6, elevation:0.9, radius:6, target:[0,0,0] },
	animate:true,
	animTime:0,
	lastFrameTime: performance.now()
};

let isDragging=false; let lastX=0,lastY=0; 
canvas.addEventListener('mousedown', e=>{ isDragging=true; lastX=e.clientX; lastY=e.clientY; });
window.addEventListener('mouseup', ()=> isDragging=false);
window.addEventListener('mousemove', e=>{
	if(!isDragging) return;
	const dx=(e.clientX-lastX), dy=(e.clientY-lastY); lastX=e.clientX; lastY=e.clientY;
	state.camera.azimuth -= dx*0.005;
	state.camera.elevation += dy*0.005;
	const maxEl = Math.PI/2 - 0.05;
	state.camera.elevation = Math.max(-maxEl, Math.min(maxEl, state.camera.elevation));
});
canvas.addEventListener('wheel', e=>{ e.preventDefault(); state.camera.radius *= Math.exp(e.deltaY*0.001); state.camera.radius = Math.min(50, Math.max(1.5, state.camera.radius)); }, {passive:false});
window.addEventListener('keydown', e=>{
	if(e.code==='KeyP'){ state.animate = !state.animate; }
	if(e.code==='KeyR'){ state.camera.azimuth=0.6; state.camera.elevation=0.9; state.camera.radius=6; state.camera.target=[0,0,0]; }
});

console.log('Base WebGL setup complete. Proceeding to geometry & shaders.');

function createSphere(latBands=32, lonBands=32, radius=1){
	const positions=[], normals=[], indices=[];
	for(let lat=0; lat<=latBands; lat++){
		const v = lat/latBands; const th = v*Math.PI;
		for(let lon=0; lon<=lonBands; lon++){
			const u = lon/lonBands; const ph = u*2*Math.PI;
			const x = Math.sin(th)*Math.cos(ph);
			const y = Math.cos(th);
			const z = Math.sin(th)*Math.sin(ph);
			positions.push(radius*x, radius*y, radius*z);
			normals.push(x,y,z);
		}
	}
	const stride = lonBands+1;
	for(let lat=0; lat<latBands; lat++){
		for(let lon=0; lon<lonBands; lon++){
			const a = lat*stride + lon;
			const b = a + stride;
			indices.push(a,b,a+1, b,a+1,b+1);
		}
	}
	return {positions:new Float32Array(positions), normals:new Float32Array(normals), indices:new Uint16Array(indices)};
}

function createGrid(size=20, div=20){
	const half = size/2; const step = size/div; const positions=[];
	for(let i=0;i<=div;i++){
		const p = -half + i*step;
		positions.push(-half,0,p,  half,0,p);
		positions.push(p,0,-half,  p,0,half);
	}
	return {positions:new Float32Array(positions), count: positions.length/3};
}

function initGeometry(){
	const sph = createSphere(30,30,1);
	state.sphere.indexCount = sph.indices.length;
	state.buffers.spherePos = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, state.buffers.spherePos); gl.bufferData(gl.ARRAY_BUFFER, sph.positions, gl.STATIC_DRAW);
	state.buffers.sphereNor = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, state.buffers.sphereNor); gl.bufferData(gl.ARRAY_BUFFER, sph.normals, gl.STATIC_DRAW);
	state.buffers.sphereIdx = gl.createBuffer();
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.buffers.sphereIdx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sph.indices, gl.STATIC_DRAW);

	const grid = createGrid(20, 20);
	state.grid.count = grid.count;
	state.buffers.grid = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, state.buffers.grid); gl.bufferData(gl.ARRAY_BUFFER, grid.positions, gl.STATIC_DRAW);
}

initGeometry();

function getShaderSource(id){
  const el = document.getElementById(id);
  if(!el){ throw new Error('Missing shader script: '+id); }
  return el.textContent.trim();
}
const sphereVS = getShaderSource('sphere-vs');
const sphereFS = getShaderSource('sphere-fs');
const gridVS = getShaderSource('grid-vs');
const gridFS = getShaderSource('grid-fs');

function initPrograms(){
	state.programs.sphere = link(sphereVS, sphereFS);
	state.programs.grid = link(gridVS, gridFS);
	const sp = state.programs.sphere;
	state.attribs.spherePos = gl.getAttribLocation(sp,'aPos');
	state.attribs.sphereNor = gl.getAttribLocation(sp,'aNor');
	state.uniforms.sphere = {
		uProj: gl.getUniformLocation(sp,'uProj'),
		uView: gl.getUniformLocation(sp,'uView'),
		uModel: gl.getUniformLocation(sp,'uModel'),
		uEye: gl.getUniformLocation(sp,'uEye')
	};
	const gp = state.programs.grid;
	state.attribs.gridPos = gl.getAttribLocation(gp,'aPos');
	state.uniforms.grid = {
		uProj: gl.getUniformLocation(gp,'uProj'),
		uView: gl.getUniformLocation(gp,'uView')
	};
}

initPrograms();

function computeCamera(){
	const c = state.camera;
	const r = c.radius;
	const eye = [
		c.target[0] + r*Math.cos(c.elevation)*Math.sin(c.azimuth),
		c.target[1] + r*Math.sin(c.elevation),
		c.target[2] + r*Math.cos(c.elevation)*Math.cos(c.azimuth)
	];
	const view = Mat4.lookAt(eye, c.target, [0,1,0]);
	const proj = Mat4.perspective(60*Math.PI/180, canvas.width/canvas.height, 0.1, 100.0);
	return {eye, view, proj};
}

function drawGrid(proj, view){
	gl.useProgram(state.programs.grid);
	gl.uniformMatrix4fv(state.uniforms.grid.uProj,false, proj);
	gl.uniformMatrix4fv(state.uniforms.grid.uView,false, view);
	gl.bindBuffer(gl.ARRAY_BUFFER, state.buffers.grid);
	gl.enableVertexAttribArray(state.attribs.gridPos);
	gl.vertexAttribPointer(state.attribs.gridPos,3,gl.FLOAT,false,0,0);
	gl.drawArrays(gl.LINES,0,state.grid.count);
}

function drawSphere(proj, view, eye, animTime){
	gl.useProgram(state.programs.sphere);
	gl.uniformMatrix4fv(state.uniforms.sphere.uProj,false,proj);
	gl.uniformMatrix4fv(state.uniforms.sphere.uView,false,view);
	gl.uniform3fv(state.uniforms.sphere.uEye, eye);
	const pulse = 0.5 + 0.5*Math.sin(animTime*2.0);
	const scale = 0.75 + pulse*0.5;
	const model = Mat4.scale(scale, scale, scale);
	gl.uniformMatrix4fv(state.uniforms.sphere.uModel,false, model);
	gl.bindBuffer(gl.ARRAY_BUFFER, state.buffers.spherePos);
	gl.enableVertexAttribArray(state.attribs.spherePos);
	gl.vertexAttribPointer(state.attribs.spherePos,3,gl.FLOAT,false,0,0);
	gl.bindBuffer(gl.ARRAY_BUFFER, state.buffers.sphereNor);
	gl.enableVertexAttribArray(state.attribs.sphereNor);
	gl.vertexAttribPointer(state.attribs.sphereNor,3,gl.FLOAT,false,0,0);
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.buffers.sphereIdx);
	gl.drawElements(gl.TRIANGLES, state.sphere.indexCount, gl.UNSIGNED_SHORT, 0);
}

function render(){
	resize();
	const now = performance.now();
	const dt = (now - state.lastFrameTime)/1000;
	state.lastFrameTime = now;
	if(state.animate){ state.animTime += dt; }
	const {eye, view, proj} = computeCamera();
	gl.enable(gl.DEPTH_TEST);
	gl.clearColor(0.05,0.07,0.09,1);
	gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
	drawGrid(proj, view);
	drawSphere(proj, view, eye, state.animTime);
	requestAnimationFrame(render);
}
requestAnimationFrame(render);