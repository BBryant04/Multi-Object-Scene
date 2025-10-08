/*
 * File: MOS.js
 * Authors: Brandon Bryant & Randall Rinehart
 * Class: COSC4103 Computer Graphics
 * Assignment #5: Multi-Object: View-Based Interaction with Single Animation.
 * Due: 10/8/2025
 * Description: Implements the WebGL scene: context setup, orbit camera controls,
 *              reference grid, inline JSON object loading (pulsing center shape
 *              and spinning/orbiting star), per-object animation (pulse, spin,
 *              orbit) and the render loop with basic Phong-style lighting.
 */

// 4x4 matrix utilities
const Mat4 = {
    // Translation matrix
    translate: (tx,ty,tz) => [
        1,0,0,0,
        0,1,0,0,
        0,0,1,0,
        tx,ty,tz,1
    ],

    // Uniform / non-uniform scale
    scale: (sx,sy,sz) => [
        sx,0, 0, 0,
        0, sy,0, 0,
        0, 0, sz,0,
        0, 0, 0, 1
    ],

    // Rotation about Y axis (right-handed)
    rotateY: (a) => {
        const c = Math.cos(a), s = Math.sin(a);
        return [
            c, 0,-s, 0,
            0, 1, 0, 0,
            s, 0, c, 0,
            0, 0, 0, 1
        ];
    },

    // Perspective projection
    perspective: (fovy, aspect, near, far) => {
        const f = 1/Math.tan(fovy/2);
        const nf = 1/(near - far);
        return [
            f/aspect, 0, 0, 0,
            0, f, 0, 0,
            0, 0, (far+near)*nf, -1,
            0, 0, (2*far*near)*nf, 0
        ];
    },

    // Right-handed lookAt (eye -> center)
    lookAt: (eye, center, up) => {
        const [ex,ey,ez] = eye;
        const [cx,cy,cz] = center;
        let [ux,uy,uz] = up;
        // Forward (from center to eye)
        let zx = ex - cx, zy = ey - cy, zz = ez - cz;
        let rl = 1/Math.hypot(zx,zy,zz); zx*=rl; zy*=rl; zz*=rl;
        // Right = up x forward
        let rx = uy*zz - uz*zy,
            ry = uz*zx - ux*zz,
            rz = ux*zy - uy*zx;
        rl = 1/Math.hypot(rx,ry,rz); rx*=rl; ry*=rl; rz*=rl;
        // Recompute orthonormal up = forward x right
        ux = zy*rz - zz*ry;
        uy = zz*rx - zx*rz;
        uz = zx*ry - zy*rx;
        return [
            rx, ux, zx, 0,
            ry, uy, zy, 0,
            rz, uz, zz, 0,
            -(rx*ex + ry*ey + rz*ez), -(ux*ex + uy*ey + uz*ez), -(zx*ex + zy*ey + zz*ez), 1
        ];
    },

    // Matrix multiply: a * b
    multiply: (a,b) => {
        const r = new Array(16);
        for (let c=0; c<4; c++) {
            for (let rI=0; rI<4; rI++) {
                r[c*4 + rI] =
                    a[0*4 + rI]*b[c*4 + 0] +
                    a[1*4 + rI]*b[c*4 + 1] +
                    a[2*4 + rI]*b[c*4 + 2] +
                    a[3*4 + rI]*b[c*4 + 3];
            }
        }
        return r;
    }
};

const canvas = document.getElementById('glcanvas');
const gl = canvas.getContext('webgl', {antialias:true});
if (!gl) {
  alert('WebGL not supported');
  throw new Error('WebGL');
}

// Keep canvas backing resolution synced with its CSS size
function resize() {
	const dpr = window.devicePixelRatio || 1;
	const w = canvas.clientWidth, h = canvas.clientHeight;
	if (canvas.width !== w*dpr || canvas.height !== h*dpr) {
		canvas.width = w*dpr;
    canvas.height = h*dpr;
	}
	gl.viewport(0,0,canvas.width,canvas.height);
}

window.addEventListener('resize', resize);
resize();

// Compile shader helper
function compile(type, src) {
	const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
	if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
		throw new Error(gl.getShaderInfoLog(s));
	return s;
}

// Link vertex + fragment shaders into a program
function link(vsSrc, fsSrc) {
	const p = gl.createProgram();
	gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
	gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
	gl.linkProgram(p);
	if (!gl.getProgramParameter(p, gl.LINK_STATUS))
		throw new Error(gl.getProgramInfoLog(p));
	return p;
}

function getShaderSource(id) {
	const el = document.getElementById(id);
	if (!el)
		throw new Error('Missing shader: ' + id);
	return el.textContent.trim();
}

// Central state bundle
const state = {
	programs: {},      // shader programs (sphere, grid, other object)
	buffers: {},       // WebGLBuffer refs
	attribs: {},       // attribute locations per program
	uniforms: {},      // uniform locations per program
    objects: [],        // array of loaded JSON objects {buffers, indexCount, color, options}
	grid: {count: 0},          // grid-specific metadata
	camera: {          // simple orbital camera
	  azimuth: 0.6,    // horizontal angle around Y axis
	  elevation: 0.9,  // vertical angle (clamped)
	  radius: 6,       // distance from target
    target: [0,0,0]  // where the camera is pointed
	},
	animate: true,     // pulse active?
	animTime: 0,       // accumulated active animation time
	lastFrameTime: performance.now() // frame timestamp
};

// ---------------- Input Handling ----------------
// Orbit camera: drag = rotate, wheel = zoom, 'A' toggles animation
let isDragging=false;
let lastX=0,lastY=0;
canvas.addEventListener('mousedown', e => { isDragging=true;
                                           lastX=e.clientX;
                                           lastY=e.clientY; });
window.addEventListener('mouseup', () => isDragging=false);
window.addEventListener('mousemove', e => {
	if (!isDragging) return;
	const dx=(e.clientX-lastX), dy=(e.clientY-lastY);
  	lastX=e.clientX;
  	lastY=e.clientY;
	// Horizontal drag changes azimuth
	state.camera.azimuth -= dx*0.005;
	// Vertical drag changes elevation, clamped to avoid flipping
	state.camera.elevation += dy*0.005;
	const maxEl = Math.PI/2 - 0.05;
	state.camera.elevation = Math.max(-maxEl, Math.min(maxEl, state.camera.elevation));
});
canvas.addEventListener('wheel', e => {
	e.preventDefault();
    state.camera.radius *= Math.exp(e.deltaY*0.001);
    state.camera.radius = Math.min(50, Math.max(1.5, state.camera.radius));
}, {passive:false});
// Key controls: A toggles animation, R resets camera
window.addEventListener('keydown', e=>{
	if (e.code==='KeyA') { state.animate = !state.animate; }
	if (e.code==='KeyR') { state.camera.azimuth=0.6;
                       state.camera.elevation=0.9;
                       state.camera.radius=6;
                       state.camera.target=[0,0,0]; }
});

// Simple XZ reference grid
function createGrid(size=20, div=20) {
	const half = size/2;
  	const step = size/div;
  	const positions=[];
	for(let i=0;i<=div;i++) {
		const p = -half + i*step;
		positions.push(-half,0,p,  half,0,p);
		positions.push(p,0,-half,  p,0,half);
	}
	return {positions:new Float32Array(positions), count: positions.length/3};
}

function initGrid() {
    const grid = createGrid(20,20);
    state.grid.count = grid.count;
    state.buffers.grid = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, state.buffers.grid);
    gl.bufferData(gl.ARRAY_BUFFER, grid.positions, gl.STATIC_DRAW);
}
initGrid();

// Build averaged (per-vertex) normals from indexed triangle list
function computeVertexNormals(positions, indices) {
    const vCount = positions.length/3;
    const normals = new Float32Array(positions.length);
    for (let i=0;i<indices.length;i+=3) {
        const a=indices[i], b=indices[i+1], c=indices[i+2];
        const ax=positions[a*3], ay=positions[a*3+1], az=positions[a*3+2];
        const bx=positions[b*3], by=positions[b*3+1], bz=positions[b*3+2];
        const cx=positions[c*3], cy=positions[c*3+1], cz=positions[c*3+2];
        // Edge vectors
        const ux=bx-ax, uy=by-ay, uz=bz-az;
        const vx=cx-ax, vy=cy-ay, vz=cz-az;
        // Face normal = (u x v)
        const nx = uy*vz - uz*vy;
        const ny = uz*vx - ux*vz;
        const nz = ux*vy - uy*vx;
        // Accumulate (not normalized yet)
        normals[a*3]+=nx; normals[a*3+1]+=ny; normals[a*3+2]+=nz;
        normals[b*3]+=nx; normals[b*3+1]+=ny; normals[b*3+2]+=nz;
        normals[c*3]+=nx; normals[c*3+1]+=ny; normals[c*3+2]+=nz;
    }
    // Normalize each vertex normal
    for (let v=0; v<vCount; v++) {
        const ix=v*3;
        const nx=normals[ix], ny=normals[ix+1], nz=normals[ix+2];
        const len=Math.hypot(nx,ny,nz) || 1;
        normals[ix]=nx/len; normals[ix+1]=ny/len; normals[ix+2]=nz/len;
    }
    return normals;
}

// Load an inline JSON object (geometry + color) by script tag id
// Options control animation parameters (pulse / spin / orbit)
function loadObject(scriptId, options={}) {
    const el = document.getElementById(scriptId);
    if (!el) { console.warn('Inline object JSON not found:', scriptId); return; }
    let data;
    try { data = JSON.parse(el.textContent); }
    catch(e) { console.error('Failed parsing JSON for', scriptId, e); return; }

    const positions = new Float32Array(data.vertices);
    const indices = new Uint16Array(data.indices);
    const normals = computeVertexNormals(positions, indices);

    const bufPos = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, bufPos);
	gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const bufNor = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, bufNor);
	gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);

    const bufIdx = gl.createBuffer();
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufIdx);
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    state.objects.push({
        buffers:{pos:bufPos,nor:bufNor,idx:bufIdx},
        indexType: gl.UNSIGNED_SHORT,
        indexCount: indices.length,
        color: new Float32Array(data.color || [0.15,0.5,0.9]),
        options: {
            pulse: options.pulse ?? false,
            baseScale: options.baseScale ?? 1.0,
            pulseAmp: options.pulseAmp ?? 0.5,
            pulseSpeed: options.pulseSpeed ?? 2.0,
            spinSpeed: options.spinSpeed ?? 0.0,        // radians per second
            orbitSpeed: options.orbitSpeed ?? 0.0,      // radians per second (around origin)
            orbitRadius: options.orbitRadius ?? 0.0,    // distance from origin
            orbitPhase: options.orbitPhase ?? 0.0       // starting angle offset
        }
    });
    console.log('Loaded inline object: ', scriptId);
}
// Object 1: orbiting, spinning star
loadObject('object-data-shape-one', {
    pulse:false,
    baseScale:1.0,
    spinSpeed: 1.5,        // radians/sec
    orbitSpeed: 0.7,       // radians/sec
    orbitRadius: 8.0,      // increased so star is further out and more visible
    orbitPhase: 0.0
});

// Object 2: pulsing polygon at origin
loadObject('object-data-shape-two', {
	pulse:true,
	baseScale:1.0,
	pulseAmp:0.5,
	pulseSpeed:2.0 });



// Compile/link shaders and cache attribute/uniform locations
function initPrograms() {
    // Generic object program (used for all JSON objects)
    const objVS = getShaderSource('object-vs');
    const objFS = getShaderSource('object-fs');
    state.programs.object = link(objVS, objFS);
    state.attribs.objectPos = gl.getAttribLocation(state.programs.object,'aPos');
    state.attribs.objectNor = gl.getAttribLocation(state.programs.object,'aNor');
    state.uniforms.object = {
        uProj: gl.getUniformLocation(state.programs.object,'uProj'),
        uView: gl.getUniformLocation(state.programs.object,'uView'),
        uModel: gl.getUniformLocation(state.programs.object,'uModel'),
        uEye: gl.getUniformLocation(state.programs.object,'uEye'),
        uColor: gl.getUniformLocation(state.programs.object,'uColor')
    };

    // Grid program
    const gridVS = getShaderSource('grid-vs');
    const gridFS = getShaderSource('grid-fs');
    state.programs.grid = link(gridVS, gridFS);
    state.attribs.gridPos = gl.getAttribLocation(state.programs.grid,'aPos');
    state.uniforms.grid = {
        uProj: gl.getUniformLocation(state.programs.grid,'uProj'),
        uView: gl.getUniformLocation(state.programs.grid,'uView')
    };
}

initPrograms();

// Compute camera matrices from orbital parameters
function computeCamera() {
	const c = state.camera;
	const r = c.radius;
	const eye = [
		c.target[0] + r*Math.cos(c.elevation)*Math.sin(c.azimuth),
		c.target[1] + r*Math.sin(c.elevation),
		c.target[2] + r*Math.cos(c.elevation)*Math.cos(c.azimuth)
	];
	const view = Mat4.lookAt(eye, c.target, [0,1,0]);      // camera transform
	const proj = Mat4.perspective(60*Math.PI/180, canvas.width/canvas.height, 0.1, 100.0); // projection
	return {eye, view, proj};
}

// Draw unlit grid first so objects properly depth test against it
function drawGrid(proj, view) {
	gl.useProgram(state.programs.grid);
	gl.uniformMatrix4fv(state.uniforms.grid.uProj,false, proj);
	gl.uniformMatrix4fv(state.uniforms.grid.uView,false, view);
	gl.bindBuffer(gl.ARRAY_BUFFER, state.buffers.grid);
	gl.enableVertexAttribArray(state.attribs.gridPos);
	gl.vertexAttribPointer(state.attribs.gridPos,3,gl.FLOAT,false,0,0);
	gl.drawArrays(gl.LINES,0,state.grid.count);
}

// Draw one animated object (pulse, spin, orbit)
function drawObject(object, proj, view, eye, animTime) {
    gl.useProgram(state.programs.object);
    gl.uniformMatrix4fv(state.uniforms.object.uProj,false, proj);
    gl.uniformMatrix4fv(state.uniforms.object.uView,false, view);
    gl.uniform3fv(state.uniforms.object.uEye, eye);
    gl.uniform3fv(state.uniforms.object.uColor, object.color);

    let scale = object.options.baseScale;
    if (object.options.pulse) {
        const t = animTime * object.options.pulseSpeed;
        const oscill = 0.5 + 0.5*Math.sin(t);
        scale += object.options.pulseAmp * oscill;
    }
    // Spin (local rotation)
    let model = Mat4.scale(scale, scale, scale);
    if (object.options.spinSpeed !== 0) {
        const spin = Mat4.rotateY(animTime * object.options.spinSpeed);
        model = Mat4.multiply(model, spin); // scale then rotate (uniform scale OK either order)
    }
    // Orbit around world origin in XZ plane
    if (object.options.orbitSpeed !== 0 && object.options.orbitRadius !== 0) {
        const ang = object.options.orbitPhase + animTime * object.options.orbitSpeed;
        const ox = Math.cos(ang) * object.options.orbitRadius;
        const oz = Math.sin(ang) * object.options.orbitRadius;
        const orbitT = Mat4.translate(ox, 0, oz);
        model = Mat4.multiply(orbitT, model); // orbit translation * (rotation * scale)
    }
    gl.uniformMatrix4fv(state.uniforms.object.uModel,false, model);

    gl.bindBuffer(gl.ARRAY_BUFFER, object.buffers.pos);
    gl.enableVertexAttribArray(state.attribs.objectPos);
    gl.vertexAttribPointer(state.attribs.objectPos,3,gl.FLOAT,false,0,0);

    gl.bindBuffer(gl.ARRAY_BUFFER, object.buffers.nor);
    gl.enableVertexAttribArray(state.attribs.objectNor);
    gl.vertexAttribPointer(state.attribs.objectNor,3,gl.FLOAT,false,0,0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, object.buffers.idx);
    gl.drawElements(gl.TRIANGLES, object.indexCount, object.indexType, 0);
}

// Frame loop: advance animation clock, draw grid then all objects
function render() {
	resize();
	const now = performance.now();
	const dt = (now - state.lastFrameTime)/1000;
	state.lastFrameTime = now;
	if (state.animate)
		state.animTime += dt;
	const {eye, view, proj} = computeCamera();
	gl.enable(gl.DEPTH_TEST); // enable hidden surface removal
	gl.clearColor(0.05,0.07,0.09,1);
	gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT); // wipe color + depth each frame
	drawGrid(proj, view);
    for (const object of state.objects)
        drawObject(object, proj, view, eye, state.animTime);
	requestAnimationFrame(render);
}
requestAnimationFrame(render);