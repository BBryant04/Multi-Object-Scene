/*
 * File: MOS.js
 * Author: Brandon Bryant
 * Class: COSC4103 Computer Graphics
 * Assignment #5: Multi-Object: View-Based Interaction with Single Animation.
 * Due: 10/8/2025
 * Description:
 */

/** Assignment Reqs
 * Build a scene of choice containing multiple objects,
 * include the objects defined by both group members.
 * Support some form of user view manipulation, applied to the entire scene.
 *  - rotation
 *  - translation
 *  - scaling
 *  -shearing
 * Apply transformations to at least one of the scene objects,
 * independent of user control,
 * causing it to animate in the scene.
 * Allow the user to toggle the animation on and off. 
 */

const cubeVertices = new Float32Array([
  // Front face (z = +0.5)
  -0.5, -0.5,  0.5,
   0.5, -0.5,  0.5,
   0.5,  0.5,  0.5,
  -0.5, -0.5,  0.5,
   0.5,  0.5,  0.5,
  -0.5,  0.5,  0.5,
  // Back face (z = -0.5)
  -0.5, -0.5, -0.5,
  -0.5,  0.5, -0.5,
   0.5,  0.5, -0.5,
  -0.5, -0.5, -0.5,
   0.5,  0.5, -0.5,
   0.5, -0.5, -0.5,
  // Left
  -0.5, -0.5, -0.5,
  -0.5, -0.5,  0.5,
  -0.5,  0.5,  0.5,
  -0.5, -0.5, -0.5,
  -0.5,  0.5,  0.5,
  -0.5,  0.5, -0.5,
  // Right
   0.5, -0.5, -0.5,
   0.5,  0.5, -0.5,
   0.5,  0.5,  0.5,
   0.5, -0.5, -0.5,
   0.5,  0.5,  0.5,
   0.5, -0.5,  0.5,
  // Top
  -0.5,  0.5,  0.5,
   0.5,  0.5,  0.5,
   0.5,  0.5, -0.5,
  -0.5,  0.5,  0.5,
   0.5,  0.5, -0.5,
  -0.5,  0.5, -0.5,
  // Bottom
  -0.5, -0.5,  0.5,
  -0.5, -0.5, -0.5,
   0.5, -0.5, -0.5,
  -0.5, -0.5,  0.5,
   0.5, -0.5, -0.5,
   0.5, -0.5,  0.5,
]);

function buildGrid(size, divisions) {
  const verts = [];
  const half = size;
  for (let i = 0; i <= divisions; i++) {
    const t = -half + (2 * half * i / divisions);
    verts.push(t, -0.5, -half,  t, -0.5, half);
    verts.push(-half, -0.5, t,  half, -0.5, t);
  }
  return new Float32Array(verts);
}
function buildLineNormals(vertexCount) {
  const arr = new Float32Array(vertexCount * 3);
  for (let i=0;i<vertexCount;i++) {
    arr[i*3+0] = 0;
    arr[i*3+1] = 1;
    arr[i*3+2] = 0;
  }
  return arr;
}
const gridVertices = buildGrid(6, 12);
const gridNormals  = buildLineNormals(gridVertices.length / 3);

const axisXVertices = new Float32Array([0,0,0,  2,0,0]);
const axisYVertices = new Float32Array([0,0,0,  0,2,0]);
const axisZVertices = new Float32Array([0,0,0,  0,0,2]);
const axisNormalsX  = buildLineNormals(2);
const axisNormalsY  = buildLineNormals(2);
const axisNormalsZ  = buildLineNormals(2);

function mat4Identity() {
  return [1,0,0,0,
          0,1,0,0,
          0,0,1,0,
          0,0,0,1];
}

function mat4Multiply(a,b) {
  const out = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c*4 + r] =
        a[0*4 + r] * b[c*4 + 0] +
        a[1*4 + r] * b[c*4 + 1] +
        a[2*4 + r] * b[c*4 + 2] +
        a[3*4 + r] * b[c*4 + 3];
    }
  }
  return out;
}

function mat4Translate(tx,ty,tz) {
  const m = mat4Identity();
  m[12]=tx; m[13]=ty; m[14]=tz;
  return m;
}

function mat4Scale(sx,sy,sz) {
  return [sx,0,0,0,
          0,sy,0,0,
          0,0,sz,0,
          0,0,0,1];
}

function mat4RotateY(angleRad) {
  const c = Math.cos(angleRad), s = Math.sin(angleRad);
  return [ c,0, s,0,
           0,1, 0,0,
          -s,0, c,0,
           0,0, 0,1];
}

function perspective(fovDeg, aspect, near, far) {
  const f = 1 / Math.tan((fovDeg * Math.PI/180)/2);
  const nf = 1 / (near - far);
  return [
    f/aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far+near)*nf, -1,
    0, 0, (2*far*near)*nf, 0
  ];
}

function lookAt(eye, target, up) {
  // f = forward (camera direction)
  let fx = target[0] - eye[0];
  let fy = target[1] - eye[1];
  let fz = target[2] - eye[2];
  const flen = Math.hypot(fx,fy,fz);
  fx/=flen; fy/=flen; fz/=flen;

  // r = right
  let rx = fy*up[2] - fz*up[1];
  let ry = fz*up[0] - fx*up[2];
  let rz = fx*up[1] - fy*up[0];
  const rlen = Math.hypot(rx,ry,rz);
  rx/=rlen; ry/=rlen; rz/=rlen;

  // u = up'
  const ux = ry*fz - rz*fy;
  const uy = rz*fx - rx*fz;
  const uz = rx*fy - ry*fx;

  // Column-major:
  // | rx  ux  -fx  0 |
  // | ry  uy  -fy  0 |
  // | rz  uz  -fz  0 |
  // | tx  ty   tz  1 |
  return [
    rx, ry, rz, 0,
    ux, uy, uz, 0,
   -fx,-fy,-fz, 0,
    -(rx*eye[0] + ry*eye[1] + rz*eye[2]),
    -(ux*eye[0] + uy*eye[1] + uz*eye[2]),
     (fx*eye[0] + fy*eye[1] + fz*eye[2]),
    1
  ];
}

function buildNormals(vertices) {
  const normals = [];
  for (let i = 0; i < vertices.length; i += 9) {
    const x1 = vertices[i],   y1 = vertices[i+1], z1 = vertices[i+2];
    const x2 = vertices[i+3], y2 = vertices[i+4], z2 = vertices[i+5];
    const x3 = vertices[i+6], y3 = vertices[i+7], z3 = vertices[i+8];
    const ux = x2 - x1, uy = y2 - y1, uz = z2 - z1;
    const vx = x3 - x1, vy = y3 - y1, vz = z3 - z1;
    let nx = uy*vz - uz*vy;
    let ny = uz*vx - ux*vz;
    let nz = ux*vy - uy*vx;
    const len = Math.hypot(nx,ny,nz) || 1;
    nx/=len; ny/=len; nz/=len;
    for (let k=0;k<3;k++) {
      normals.push(nx,ny,nz);
    }
  }
  return new Float32Array(normals);
}

function main() {
	const canvas = document.getElementById('glcanvas');
	const gl = canvas.getContext('webgl');
	if (!gl) {
		alert('WebGL not supported');
		return;
	}

    let orbitYaw   = Math.PI * 0.35;
    let orbitPitch = 0.35;          
    let orbitRadius = 4.0;          
    const target = [0,0,0];
    
    let isDragging = false;
    let lastX = 0, lastY = 0;
    const YAW_SPEED = 0.005;
    const PITCH_SPEED = 0.005;
    const PITCH_MIN = -Math.PI/2 + 0.05;
    const PITCH_MAX =  Math.PI/2 - 0.05;

    canvas.addEventListener('mousedown', (e) => {
        if (e.button === 0) { // left
            isDragging = true;
            lastX = e.clientX;
            lastY = e.clientY;
        }
    });
    window.addEventListener('mouseup', () => { isDragging = false; });
    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        orbitYaw += dx * YAW_SPEED;
        orbitPitch += dy * PITCH_SPEED;
        if (orbitPitch > PITCH_MAX) orbitPitch = PITCH_MAX;
        if (orbitPitch < PITCH_MIN) orbitPitch = PITCH_MIN;
    });

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomFactor = 1 + (e.deltaY * 0.001);
        orbitRadius *= zoomFactor;
        if (orbitRadius < 1.2) orbitRadius = 1.2;
        if (orbitRadius > 25)  orbitRadius = 25;
    }, { passive: false });

	const vsSource = document.getElementById('vertex-shader').textContent;
	const fsSource = document.getElementById('fragment-shader').textContent;

	function createShader(gl, type, source) {
		const shader = gl.createShader(type);
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
            console.error(gl.getShaderInfoLog(shader));
        return shader;
	}

	function createProgram(gl, vsSource, fsSource) {
		const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
		const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
		const program = gl.createProgram();
		gl.attachShader(program, vs);
		gl.attachShader(program, fs);
		gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
            console.error(gl.getProgramInfoLog(program));
		return program;
	}

	const program = createProgram(gl, vsSource, fsSource);
	gl.useProgram(program);

    const aPosition = gl.getAttribLocation(program, 'aPosition');
    const aNormal = gl.getAttribLocation(program, 'aNormal');
    const uMVP = gl.getUniformLocation(program, 'uMVP');
    const uModel = gl.getUniformLocation(program, 'uModel');
    const uColor = gl.getUniformLocation(program, 'uColor');
    const uLightDir = gl.getUniformLocation(program, 'uLightDir');
    const uEye = gl.getUniformLocation(program, 'uEye');

    function makeVBO(data) {
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        return { buffer: b, count: data.length / 3 };
    }

    const cube = makeVBO(cubeVertices);
    const cubeNormals = makeVBO(buildNormals(cubeVertices));
    const gridVBO      = makeVBO(gridVertices);
    const gridNormalVBO= makeVBO(gridNormals);
    const axisXVBO     = makeVBO(axisXVertices);
    const axisXNormVBO = makeVBO(axisNormalsX);
    const axisYVBO     = makeVBO(axisYVertices);
    const axisYNormVBO = makeVBO(axisNormalsY);
    const axisZVBO     = makeVBO(axisZVertices);
    const axisZNormVBO = makeVBO(axisNormalsZ);

    let animate = true;
    let cubeAngle = 0;
    let showGridAxes = true;
    document.addEventListener('keydown', (e) => {
        if (e.key === 'a' || e.key === 'A') {
            animate = !animate;
            console.log('Animation:', animate ? 'ON' : 'OFF');
        }
        if (e.key === 'g' || e.key === 'G') {    // <--- ADD
            showGridAxes = !showGridAxes;
            console.log('Grid/Axes:', showGridAxes ? 'ON' : 'OFF');
        }
    });

	gl.enableVertexAttribArray(aPosition);
  gl.enableVertexAttribArray(aNormal);
  gl.clearColor(0.10, 0.10, 0.12, 1);

	function drawObject(obj, normalsObj, model, color, view, proj) {
    const vp = mat4Multiply(proj, view);
    const mvp = mat4Multiply(vp, model);
    gl.uniformMatrix4fv(uMVP, false, new Float32Array(mvp));
    gl.uniformMatrix4fv(uModel, false, new Float32Array(model));
    gl.uniform3fv(uColor, new Float32Array(color));
    gl.bindBuffer(gl.ARRAY_BUFFER, obj.buffer);
    gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, normalsObj.buffer);
    gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, obj.count);
  }

  function drawLines(obj, normalsObj, model, color, view, proj) {
    const vp = mat4Multiply(proj, view);
    const mvp = mat4Multiply(vp, model);
    gl.uniformMatrix4fv(uMVP, false, new Float32Array(mvp));
    gl.uniformMatrix4fv(uModel, false, new Float32Array(model));
    gl.uniform3fv(uColor, new Float32Array(color));
    gl.bindBuffer(gl.ARRAY_BUFFER, obj.buffer);
    gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, normalsObj.buffer);
    gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, 0, obj.count);
  }

  function render() {
    gl.viewport(0,0,canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.uniform3fv(uLightDir, new Float32Array([0.6, 1.0, 0.8]));

    if (animate) cubeAngle += 0.01;

    const cp = Math.cos(orbitPitch);
    const sp = Math.sin(orbitPitch);
    const cy = Math.cos(orbitYaw);
    const sy = Math.sin(orbitYaw);
    const eye = [
        target[0] + orbitRadius * cp * sy,
        target[1] + orbitRadius * sp,
        target[2] + orbitRadius * cp * cy
    ];

    gl.uniform3fv(uEye, new Float32Array(eye));

    const up = [0,1,0];
    const view = lookAt(eye, target, up);
    const proj = perspective(60, canvas.width/canvas.height, 0.1, 100);

    if (showGridAxes) {
        const I = mat4Identity();
        // Grid (neutral gray)
        drawLines(gridVBO, gridNormalVBO, I, [0.35,0.35,0.40], view, proj);
        // Axes (X=red, Y=green, Z=blue)
        drawLines(axisXVBO, axisXNormVBO, I, [1.0,0.15,0.15], view, proj);
        drawLines(axisYVBO, axisYNormVBO, I, [0.15,1.0,0.25], view, proj);
        drawLines(axisZVBO, axisZNormVBO, I, [0.2,0.4,1.0], view, proj);
    }

    const cubeModel = mat4Multiply(
        mat4Translate(-0.9, 0, 0),
        mat4RotateY(cubeAngle)
    );
    
    drawObject(cube, cubeNormals, cubeModel, [0.2, 0.7, 1.0], view, proj);

    requestAnimationFrame(render);
  }

  render();
}

window.onload = main;