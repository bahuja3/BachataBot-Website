class FullBodyTracker {
  constructor() {
    // Performance tracking
    this.fps = 0;
    this.frameCount = 0;
    this.lastFpsTime = Date.now();
    this.targetFps = 30; // Limit to 30 FPS for better performance
    this.frameInterval = 1000 / this.targetFps;
    this.lastFrameTime = 0;
    
    // Throttled logging
    this.logInterval = 2000; // Log every 2 seconds
    this.lastLogTime = 0;
    
    // Tracking state
    this.isTracking = false;
    this.poseLandmarks = null;
    this.poseWorldLandmarks = null;
    this.faceLandmarks = null;
    this.handsLandmarks = [];
    
    // Module states
    this.pose = null;
    this.faceMesh = null;
    this.hands = null;
    this.videoElement = null;
    this.canvasElement = null;
    this.canvasCtx = null;
    
    // Performance flags
    this.showPose = true;
    this.showFace = true;
    this.showHands = true;
    this.showDebug = true;
    
    // Debug elements
    this.debugOutput = null;
    this.loadingElement = null;
    
    // Error handling
    this.retryCount = 0;
    this.maxRetries = 3;
  }

  setupDebugControls() {
    // Initialize debug output for console logging only
    this.debugOutput = null;
  }

  async init() {
    this.log('🚀 Initializing Full Body & Face Tracker...');
    
    try {
      // Wait for DOM to be fully loaded
      if (document.readyState !== 'complete') {
        this.log('⏳ Waiting for DOM to load...');
        await new Promise(resolve => {
          window.addEventListener('load', resolve);
        });
      }
      
      // Initialize debug system
      this.setupDebugControls();
      
      // Initialize canvas with error handling
      this.canvasElement = document.getElementById('tracking-canvas');
      if (!this.canvasElement) {
        throw new Error('Canvas element "tracking-canvas" not found. Please check HTML structure.');
      }
      this.canvasCtx = this.canvasElement.getContext('2d');
      
      // Initialize video element
      this.videoElement = document.createElement('video');
      
      // Setup MediaPipe modules sequentially to avoid WASM conflicts
      await this.setupMediaPipeSequentially();
      
      // Start camera
      await this.startCamera();
      
      // Start optimized tracking loop
      this.startOptimizedTracking();
      
      // Hide loading screen
      this.hideLoading();
      
      this.log('✅ Full body tracking started');
      
    } catch (error) {
      this.log(`❌ Initialization failed: ${error.message}`, 'error');
      this.updateStatus('camera', 'error');
      this.showErrorModal(error.message);
    }
  }

  async setupMediaPipeSequentially() {
    this.log('🔧 Setting up MediaPipe modules sequentially...');
    
    // 1. Setup Pose first (most important for full body)
    await this.setupPose();
    
    // 2. Setup FaceMesh (can conflict with Pose WASM)
    await this.setupFaceMesh();
    
    // 3. Setup Hands (least critical, can be disabled)
    await this.setupHands();
    
    this.log('✅ All MediaPipe modules initialized');
  }

  async setupPose() {
    try {
      this.log('🔧 Setting up MediaPipe Pose...');
      
      this.pose = new Pose({
        locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1635988162/${file}`;
        }
      });
      
      this.pose.setOptions({
        modelComplexity: 0, // Lightest model for best performance
        smoothLandmarks: false, // Disable smoothing for speed
        enableSegmentation: false,
        smoothSegmentation: false,
        minDetectionConfidence: 0.3,
        minTrackingConfidence: 0.3
      });
      
      this.pose.onResults((results) => this.onPoseResults(results));
      
      this.log('✅ MediaPipe Pose initialized');
      this.updateStatus('pose', 'active');
      
    } catch (error) {
      this.log(`❌ Pose initialization failed: ${error.message}`, 'error');
      this.updateStatus('pose', 'error');
      throw error;
    }
  }

  async setupFaceMesh() {
    try {
      this.log('🔧 Setting up MediaPipe FaceMesh...');
      
      // Small delay to avoid WASM conflicts
      await new Promise(resolve => setTimeout(resolve, 100));
      
      this.faceMesh = new FaceMesh({
        locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`;
        }
      });
      
      this.faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: false, // Disable refinement for performance
        minDetectionConfidence: 0.3,
        minTrackingConfidence: 0.3
      });
      
      this.faceMesh.onResults((results) => this.onFaceResults(results));
      
      this.log('✅ MediaPipe FaceMesh initialized');
      this.updateStatus('face', 'active');
      
    } catch (error) {
      this.log(`⚠️ FaceMesh initialization failed: ${error.message}. Continuing without face tracking.`);
      this.faceMesh = null;
      this.showFace = false;
      this.updateStatus('face', 'error');
    }
  }

  async setupHands() {
    try {
      this.log('🔧 Setting up MediaPipe Hands...');
      
      // Small delay to avoid WASM conflicts
      await new Promise(resolve => setTimeout(resolve, 100));
      
      this.hands = new Hands({
        locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/${file}`;
        }
      });
      
      this.hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 0, // Lightest model for performance
        minDetectionConfidence: 0.3,
        minTrackingConfidence: 0.3
      });
      
      this.hands.onResults((results) => this.onHandsResults(results));
      
      this.log('✅ MediaPipe Hands initialized');
      this.updateStatus('hands', 'active');
      
    } catch (error) {
      this.log(`⚠️ Hands initialization failed: ${error.message}. Continuing without hands tracking.`);
      this.hands = null;
      this.showHands = false;
      this.updateStatus('hands', 'error');
    }
  }

  async startCamera(width = 640, height = 480) {
    this.log('📹 Starting camera...');
    
    try {
      // Request camera with optimized settings
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: width, max: 1280 }, 
          height: { ideal: height, max: 720 },
          facingMode: 'user',
          frameRate: { ideal: 30, max: 30 } // Limit frame rate for performance
        } 
      });
      
      this.log('Camera permissions granted');
      
      // Setup video element
      this.videoElement.autoplay = true;
      this.videoElement.playsInline = true;
      this.videoElement.muted = true;
      this.videoElement.srcObject = stream;
      
      // Wait for video to be ready
      await new Promise((resolve) => {
        this.videoElement.onloadedmetadata = () => {
          this.videoElement.play();
          resolve();
        };
      });
      
      this.log('✅ Camera started successfully');
      this.updateStatus('camera', 'active');
      
    } catch (error) {
      this.log(`❌ Camera start failed: ${error.message}`, 'error');
      this.updateStatus('camera', 'error');
      throw new Error('Unable to access webcam. Please ensure it is connected and permissions are granted.');
    }
  }

  onPoseResults(results) {
    this.poseLandmarks = results.poseLandmarks;
    this.poseWorldLandmarks = results.poseWorldLandmarks;
    
    if (this.showPose) {
      this.drawPoseLandmarks();
    }
    
    this.updateTrackingStatus();
    
    // Throttled logging
    const now = Date.now();
    if (now - this.lastLogTime >= this.logInterval) {
      this.logPoseData();
      this.lastLogTime = now;
    }
  }

  onFaceResults(results) {
    this.faceLandmarks = results.multiFaceLandmarks?.[0] || null;
    
    if (this.showFace && this.faceLandmarks) {
      this.drawFaceLandmarks();
    }
    
    // Throttled logging - only log every 2 seconds
    const now = Date.now();
    if (now - this.lastLogTime >= this.logInterval && this.faceLandmarks) {
      this.logFaceData();
      this.lastLogTime = now;
    }
  }

  onHandsResults(results) {
    this.handsLandmarks = results.multiHandLandmarks || [];
    
    if (this.showHands && this.handsLandmarks.length > 0) {
      this.drawHandsLandmarks();
    }
    
    // Throttled logging - only log every 2 seconds
    const now = Date.now();
    if (now - this.lastLogTime >= this.logInterval && this.handsLandmarks.length > 0) {
      this.logHandsData();
      this.lastLogTime = now;
    }
  }

  // Helper function to flip X coordinate for mirror effect
  flipX(x, width) {
    return width - x;
  }

  renderFrame() {
    if (!this.videoElement || !this.videoElement.videoWidth) return;
    
    // Update canvas size
    this.resizeCanvas();
    
    // Clear canvas efficiently
    this.canvasCtx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
    
    // Save the current context state
    this.canvasCtx.save();
    
    // Flip the canvas horizontally to create a mirror effect
    this.canvasCtx.scale(-1, 1);
    this.canvasCtx.translate(-this.canvasElement.width, 0);
    
    // Draw video frame (now flipped)
    this.canvasCtx.drawImage(
      this.videoElement, 
      0, 0, 
      this.canvasElement.width, 
      this.canvasElement.height
    );
    
    // Restore the context state
    this.canvasCtx.restore();
    
    // Update FPS counter
    this.updateFPS();
  }

  drawPoseLandmarks() {
    if (!this.poseLandmarks || !this.showPose) return;
    
    const ctx = this.canvasCtx;
    const width = this.canvasElement.width;
    const height = this.canvasElement.height;
    
    // Draw pose landmarks with optimized rendering
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 3;
    ctx.fillStyle = '#00FF00';
    
    // Draw connections
    const connections = [
      [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], // Arms
      [11, 23], [12, 24], [23, 24], // Torso
      [23, 25], [25, 27], [27, 29], [29, 31], // Left leg
      [24, 26], [26, 28], [28, 30], [30, 32], // Right leg
      [15, 17], [15, 19], [15, 21], // Left hand
      [16, 18], [16, 20], [16, 22], // Right hand
    ];
    
    connections.forEach(([start, end]) => {
      const startPoint = this.poseLandmarks[start];
      const endPoint = this.poseLandmarks[end];
      
      if (startPoint && endPoint && 
          startPoint.visibility > 0.3 && endPoint.visibility > 0.3) {
        ctx.beginPath();
        ctx.moveTo(this.flipX(startPoint.x * width, width), startPoint.y * height);
        ctx.lineTo(this.flipX(endPoint.x * width, width), endPoint.y * height);
        ctx.stroke();
      }
    });
    
    // Draw key points
    this.poseLandmarks.forEach((landmark, index) => {
      if (landmark.visibility > 0.3) {
        ctx.beginPath();
        ctx.arc(
          this.flipX(landmark.x * width, width), 
          landmark.y * height, 
          6, 0, 2 * Math.PI
        );
        ctx.fill();
        
        // Draw labels for key points
        if (this.showDebug && [0, 11, 12, 23, 24].includes(index)) {
          ctx.fillStyle = 'white';
          ctx.font = '12px Arial';
          ctx.fillText(
            `${index}`, 
            this.flipX(landmark.x * width, width) + 10, 
            landmark.y * height - 10
          );
          ctx.fillStyle = '#00FF00';
        }
      }
    });
  }

  drawFaceLandmarks() {
    if (!this.faceLandmarks || !this.showFace) return;
    
    const ctx = this.canvasCtx;
    const width = this.canvasElement.width;
    const height = this.canvasElement.height;
    
    // Draw face mesh with optimized settings
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#FFD700';
    
    // Draw face contours
    const faceContours = [
      [10, 338], [338, 297], [297, 332], [332, 284], [284, 251], [251, 389], [389, 356], [356, 454], [454, 323], [323, 361], [361, 288], [288, 397], [397, 365], [365, 379], [379, 378], [378, 400], [400, 377], [377, 152], [152, 148], [148, 176], [176, 149], [149, 150], [150, 136], [136, 172], [172, 58], [58, 132], [132, 93], [93, 234], [234, 127], [127, 162], [162, 21], [21, 54], [54, 103], [103, 67], [67, 109], [109, 10]
    ];
    
    faceContours.forEach(([start, end]) => {
      const startPoint = this.faceLandmarks[start];
      const endPoint = this.faceLandmarks[end];
      
      if (startPoint && endPoint) {
        ctx.beginPath();
        ctx.moveTo(this.flipX(startPoint.x * width, width), startPoint.y * height);
        ctx.lineTo(this.flipX(endPoint.x * width, width), endPoint.y * height);
        ctx.stroke();
      }
    });
    
    // Draw key facial landmarks
    const keyLandmarks = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255, 256, 257, 258, 259, 260, 261, 262, 263, 264, 265, 266, 267, 268, 269, 270, 271, 272, 273, 274, 275, 276, 277, 278, 279, 280, 281, 282, 283, 284, 285, 286, 287, 288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299, 300, 301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316, 317, 318, 319, 320, 321, 322, 323, 324, 325, 326, 327, 328, 329, 330, 331, 332, 333, 334, 335, 336, 337, 338, 339, 340, 341, 342, 343, 344, 345, 346, 347, 348, 349, 350, 351, 352, 353, 354, 355, 356, 357, 358, 359, 360, 361, 362, 363, 364, 365, 366, 367, 368, 369, 370, 371, 372, 373, 374, 375, 376, 377, 378, 379, 380, 381, 382, 383, 384, 385, 386, 387, 388, 389, 390, 391, 392, 393, 394, 395, 396, 397, 398, 399, 400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418, 419, 420, 421, 422, 423, 424, 425, 426, 427, 428, 429, 430, 431, 432, 433, 434, 435, 436, 437, 438, 439, 440, 441, 442, 443, 444, 445, 446, 447, 448, 449, 450, 451, 452, 453, 454, 455, 456, 457, 458, 459, 460, 461, 462, 463, 464, 465, 466, 467];
    
    keyLandmarks.forEach(index => {
      const landmark = this.faceLandmarks[index];
      if (landmark) {
        ctx.beginPath();
        ctx.arc(
          this.flipX(landmark.x * width, width), 
          landmark.y * height, 
          2, 0, 2 * Math.PI
        );
        ctx.fill();
      }
    });
  }

  drawHandsLandmarks() {
    if (!this.handsLandmarks || !this.showHands) return;
    
    const ctx = this.canvasCtx;
    const width = this.canvasElement.width;
    const height = this.canvasElement.height;
    
    this.handsLandmarks.forEach((handLandmarks, handIndex) => {
      const handColor = handIndex === 0 ? '#FF6B6B' : '#4ECDC4';
      
      ctx.strokeStyle = handColor;
      ctx.lineWidth = 2;
      ctx.fillStyle = handColor;
      
      // Draw hand connections
      const connections = [
        [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
        [0, 5], [5, 6], [6, 7], [7, 8], // Index finger
        [0, 9], [9, 10], [10, 11], [11, 12], // Middle finger
        [0, 13], [13, 14], [14, 15], [15, 16], // Ring finger
        [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
        [5, 9], [9, 13], [13, 17] // Palm connections
      ];
      
      connections.forEach(([start, end]) => {
        const startPoint = handLandmarks[start];
        const endPoint = handLandmarks[end];
        
        if (startPoint && endPoint) {
          ctx.beginPath();
          ctx.moveTo(this.flipX(startPoint.x * width, width), startPoint.y * height);
          ctx.lineTo(this.flipX(endPoint.x * width, width), endPoint.y * height);
          ctx.stroke();
        }
      });
      
      // Draw hand landmarks
      handLandmarks.forEach((landmark, index) => {
        ctx.beginPath();
        ctx.arc(
          this.flipX(landmark.x * width, width), 
          landmark.y * height, 
          4, 0, 2 * Math.PI
        );
        ctx.fill();
        
        // Draw labels for key points
        if (this.showDebug && [0, 4, 8, 12, 16, 20].includes(index)) {
          ctx.fillStyle = 'white';
          ctx.font = '10px Arial';
          ctx.fillText(
            `${index}`, 
            this.flipX(landmark.x * width, width) + 8, 
            landmark.y * height - 8
          );
          ctx.fillStyle = handColor;
        }
      });
    });
  }

  updateFPS() {
    this.frameCount++;
    const now = Date.now();
    
    if (now - this.lastFpsTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsTime = now;
      
      const fpsDisplay = document.getElementById('fps-display');
      if (fpsDisplay) {
        fpsDisplay.textContent = this.fps;
      }
    }
  }

  resizeCanvas() {
    if (!this.videoElement || !this.canvasElement) return;
    
    const videoWidth = this.videoElement.videoWidth;
    const videoHeight = this.videoElement.videoHeight;
    
    if (videoWidth && videoHeight) {
      this.canvasElement.width = videoWidth;
      this.canvasElement.height = videoHeight;
    }
  }

  updateTrackingStatus() {
    const poseStatus = this.poseLandmarks ? 'detected' : 'searching';
    const faceStatus = this.faceLandmarks ? 'detected' : 'searching';
    const handsStatus = this.handsLandmarks.length > 0 ? 'detected' : 'searching';
    
    this.updateStatus('pose', poseStatus);
    this.updateStatus('face', faceStatus);
    this.updateStatus('hands', handsStatus);
  }

  startOptimizedTracking() {
    this.isTracking = true;
    this.log('🎯 Starting optimized tracking loop...');
    
    const processFrame = async () => {
      if (!this.isTracking) return;
      
      const now = Date.now();
      
      // Frame rate limiting
      if (now - this.lastFrameTime < this.frameInterval) {
        requestAnimationFrame(processFrame);
        return;
      }
      
      this.lastFrameTime = now;
      
      try {
        // Process video frame with error handling
        if (this.videoElement && this.videoElement.readyState >= 2) {
          // Always render the video frame first
          this.renderFrame();
          
          // Process all modules with small delays to avoid conflicts
          if (this.pose && this.showPose) {
            await this.pose.send({ image: this.videoElement });
          }
          
          if (this.faceMesh && this.showFace) {
            await this.faceMesh.send({ image: this.videoElement });
          }
          
          if (this.hands && this.showHands) {
            await this.hands.send({ image: this.videoElement });
          }
        }
      } catch (error) {
        this.log(`⚠️ Frame processing error: ${error.message}`, 'warning');
      }
      
      requestAnimationFrame(processFrame);
    };
    
    processFrame();
  }

  logPoseData() {
    if (!this.poseLandmarks || !this.showDebug) return;
    
    const visibleLandmarks = this.poseLandmarks.filter(lm => lm.visibility > 0.3).length;
    this.log(`🏃 Pose: ${visibleLandmarks}/${this.poseLandmarks.length} landmarks visible`);
  }

  logFaceData() {
    if (!this.faceLandmarks || !this.showDebug) return;
    
    this.log(`👤 Face: ${this.faceLandmarks.length} landmarks detected`);
  }

  logHandsData() {
    if (!this.handsLandmarks || !this.showDebug) return;
    
    this.log(`✋ Hands: ${this.handsLandmarks.length} hand(s) detected`);
  }

  updateStatus(type, status) {
    const statusElement = document.getElementById(`${type}-status`);
    if (statusElement) {
      statusElement.textContent = status;
      statusElement.style.color = status === 'active' || status === 'detected' ? '#00FF00' : 
                                 status === 'error' ? '#FF0000' : '#FFFF00';
    }
  }

  log(message, type = 'info') {
    if (!this.showDebug) return;
    
    const timestamp = new Date().toLocaleTimeString();
    
    // Log to console with appropriate styling
    switch (type) {
      case 'error':
        console.error(`[${timestamp}] ❌ ${message}`);
        break;
      case 'warning':
        console.warn(`[${timestamp}] ⚠️ ${message}`);
        break;
      case 'success':
        console.log(`[${timestamp}] ✅ ${message}`);
        break;
      default:
        console.log(`[${timestamp}] ℹ️ ${message}`);
    }
  }



  hideLoading() {
    const loadingElement = document.getElementById('loading');
    if (loadingElement) {
      loadingElement.style.display = 'none';
    }
  }

  showErrorModal(message) {
    // Create error modal if it doesn't exist
    if (!document.getElementById('error-modal')) {
      const modal = document.createElement('div');
      modal.id = 'error-modal';
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
      `;
      
      modal.innerHTML = `
        <div style="background: #333; padding: 20px; border-radius: 8px; max-width: 400px; text-align: center;">
          <h3 style="color: #FF6B6B; margin-bottom: 15px;">Error</h3>
          <p style="color: white; margin-bottom: 20px;">${message}</p>
          <button onclick="closeErrorModal()" style="background: #FF6B6B; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer;">Close</button>
        </div>
      `;
      
      document.body.appendChild(modal);
    } else {
      document.getElementById('error-modal').style.display = 'flex';
    }
  }
}

// Global functions
function toggleFullscreen(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  
  if (!document.fullscreenElement) {
    canvas.requestFullscreen().catch(err => {
      console.log('Error attempting to enable fullscreen:', err);
    });
  } else {
    document.exitFullscreen();
  }
}

function closeErrorModal() {
  const modal = document.getElementById('error-modal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// Initialize tracker when DOM is loaded
let tracker;
document.addEventListener('DOMContentLoaded', () => {
  tracker = new FullBodyTracker();
  tracker.init();
}); 