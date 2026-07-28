// Raw HTML/Canvas Welcome Screen — rendered inside a WebView (native) or iframe (web).
// Buttons post messages back to the native app via window.ReactNativeWebView.postMessage.
// Zero drops/particles — subtle multi-layer frosted gold glass ribbons only.
export const WELCOME_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
<title>Jaleter</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap" />
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    width: 100%; height: 100%;
    background: #090908;
    overflow: hidden;
    -webkit-user-select: none; user-select: none;
    -webkit-tap-highlight-color: transparent;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  #stage {
    position: fixed; inset: 0;
    display: flex; flex-direction: column; justify-content: space-between;
    padding: 0 24px 40px;
    z-index: 20;
  }
  .ambient-glow {
    position: absolute;
    bottom: -80px; right: -80px;
    width: 320px; height: 320px;
    border-radius: 9999px;
    filter: blur(48px);
    opacity: 0.70;
    background: radial-gradient(circle, rgba(222,170,85,0.07) 0%, rgba(166,124,82,0.03) 45%, rgba(9,9,8,0) 70%);
    pointer-events: none;
    z-index: 0;
  }
  #bgCanvas {
    position: fixed; inset: 0;
    width: 100%; height: 100%;
    pointer-events: none;
    z-index: 10;
  }
  .brand {
    width: 100%;
    display: flex; flex-direction: column; align-items: center; text-align: center;
    margin-top: 28vh;
  }
  .logo {
    font-family: 'Playfair Display', Georgia, serif;
    font-size: 58px;
    line-height: 1;
    font-weight: 400;
    color: #EED7AB;
    letter-spacing: 0;
    margin: 0; padding: 0;
    overflow: visible;
  }
  .tagline {
    margin-top: 24px;
    color: rgba(255, 248, 235, 0.65);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.28em;
    line-height: 1.75;
    text-transform: uppercase;
    text-align: center;
  }
  .spacer { flex-grow: 1; }
  .actions {
    width: 100%;
    display: flex; flex-direction: column; align-items: center; justify-content: flex-end;
    margin-bottom: 8px;
  }
  .cta {
    width: 78%;
    height: 52px;
    border-radius: 9999px;
    display: flex; align-items: center; justify-content: center;
    color: #090908;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
    border: 0;
    background: linear-gradient(135deg, #F4D28F 0%, #DEAA55 100%);
    box-shadow: 0 4px 20px rgba(222,170,85,0.12);
    cursor: pointer;
    transition: transform 120ms ease, opacity 120ms ease;
    font-family: 'Inter', sans-serif;
  }
  .cta:active { transform: scale(0.95); }
  .login-row {
    margin-top: 20px;
    font-size: 13px;
    font-weight: 400;
    text-align: center;
  }
  .login-row .muted { color: #8E8A83; }
  .login-btn {
    color: #DEAA55;
    font-weight: 500;
    background: transparent;
    border: 0;
    padding: 0;
    margin-left: 2px;
    cursor: pointer;
    font-family: 'Inter', sans-serif;
    font-size: 13px;
  }
  .login-btn:hover { text-decoration: underline; }
  @media (min-width: 600px) {
    .logo { font-size: 62px; }
    .tagline { font-size: 11.5px; }
  }
</style>
</head>
<body>
  <div class="ambient-glow"></div>
  <canvas id="bgCanvas"></canvas>
  <div id="stage">
    <div class="brand">
      <h1 class="logo">Jaleter</h1>
      <div class="tagline">SMART BUDGETING.<br />WEALTHY LIVING.</div>
    </div>
    <div class="spacer"></div>
    <div class="actions">
      <button id="btnStart" class="cta" type="button">Get Started</button>
      <div class="login-row">
        <span class="muted">Already have an account?</span>
        <button id="btnLogin" class="login-btn" type="button">Log in</button>
      </div>
    </div>
  </div>

<script>
  (function() {
    var canvas = document.getElementById('bgCanvas');
    var ctx = canvas.getContext('2d');
    var width = 0, height = 0, time = 0;
    var animationFrameId;

    function resizeCanvas() {
      try {
        width = window.innerWidth || 393;
        height = window.innerHeight || 852;
        var dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
      } catch (e) {}
    }

    // Subtle frosted glass lens ribbon renderer (Zero drops/particles)
    function drawSubtleGlassLayer(config) {
      var yRatio = config.yRatio, amplitude = config.amplitude, freq = config.freq;
      var speed = config.speed, thickness = config.thickness, opacity = config.opacity;
      var phaseOffset = config.phaseOffset;
      var pointsTop = [], pointsBottom = [];
      var stepX = 8;
      var yBase = height * yRatio;

      for (var x = -20; x <= width + 20; x += stepX) {
        var normX = x / Math.max(1, width);
        // Smooth glass arch curvature
        var baseArc = Math.sin(normX * Math.PI) * 32;
        var wave1 = Math.sin(x * freq + time * speed + phaseOffset) * amplitude;
        var wave2 = Math.cos(x * freq * 1.4 - time * speed * 0.6) * (amplitude * 0.3);
        var centerY = yBase + baseArc + wave1 + wave2;
        var dynamicThickness = thickness + Math.sin(normX * Math.PI * 2 + time * 0.0015) * (thickness * 0.2);
        pointsTop.push({ x: x, y: centerY - dynamicThickness / 2 });
        pointsBottom.push({ x: x, y: centerY + dynamicThickness / 2 });
      }

      // 1. Translucent Frosted Glass Body
      ctx.beginPath();
      ctx.moveTo(pointsTop[0].x, pointsTop[0].y);
      for (var i = 1; i < pointsTop.length; i++) ctx.lineTo(pointsTop[i].x, pointsTop[i].y);
      for (var j = pointsBottom.length - 1; j >= 0; j--) ctx.lineTo(pointsBottom[j].x, pointsBottom[j].y);
      ctx.closePath();
      var glassBodyGrad = ctx.createLinearGradient(0, yBase - 40, width, yBase + 60);
      glassBodyGrad.addColorStop(0, 'rgba(238,215,171,' + (opacity * 0.04) + ')');
      glassBodyGrad.addColorStop(0.4, 'rgba(244,210,143,' + (opacity * 0.22) + ')');
      glassBodyGrad.addColorStop(0.75, 'rgba(222,170,85,' + (opacity * 0.15) + ')');
      glassBodyGrad.addColorStop(1, 'rgba(180,120,40,' + (opacity * 0.02) + ')');
      ctx.fillStyle = glassBodyGrad;
      ctx.fill();

      // 2. Soft Light Caustic Sheen Sweep across Glass Surface
      ctx.save();
      ctx.clip(); // Keep specular reflection inside glass body
      var sheenX = ((time * 20 + phaseOffset * 100) % (Math.max(1, width) * 2.4)) - width * 0.7;
      var causticGrad = ctx.createLinearGradient(sheenX, yBase - 60, sheenX + 110, yBase + 60);
      causticGrad.addColorStop(0, 'rgba(255,255,255,0)');
      causticGrad.addColorStop(0.45, 'rgba(255,250,235,' + (opacity * 0.28) + ')');
      causticGrad.addColorStop(0.55, 'rgba(255,255,255,' + (opacity * 0.45) + ')');
      causticGrad.addColorStop(0.65, 'rgba(244,210,143,' + (opacity * 0.18) + ')');
      causticGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = causticGrad;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();

      // 3. Specular Top Glass Bevel Rim
      ctx.beginPath();
      ctx.moveTo(pointsTop[0].x, pointsTop[0].y);
      for (var k = 1; k < pointsTop.length; k++) ctx.lineTo(pointsTop[k].x, pointsTop[k].y);
      var topRimGrad = ctx.createLinearGradient(0, 0, width, 0);
      topRimGrad.addColorStop(0, 'rgba(238,215,171,0)');
      topRimGrad.addColorStop(0.25, 'rgba(255,250,235,' + (opacity * 0.65) + ')');
      topRimGrad.addColorStop(0.6, 'rgba(244,210,143,' + (opacity * 0.75) + ')');
      topRimGrad.addColorStop(1, 'rgba(222,170,85,0)');
      ctx.strokeStyle = topRimGrad;
      ctx.lineWidth = 1.0;
      ctx.stroke();

      // 4. Subtle Bottom Refractive Edge
      ctx.beginPath();
      ctx.moveTo(pointsBottom[0].x, pointsBottom[0].y);
      for (var m = 1; m < pointsBottom.length; m++) ctx.lineTo(pointsBottom[m].x, pointsBottom[m].y);
      var bottomRimGrad = ctx.createLinearGradient(0, 0, width, 0);
      bottomRimGrad.addColorStop(0, 'rgba(222,170,85,0)');
      bottomRimGrad.addColorStop(0.5, 'rgba(222,170,85,' + (opacity * 0.35) + ')');
      bottomRimGrad.addColorStop(1, 'rgba(222,170,85,0)');
      ctx.strokeStyle = bottomRimGrad;
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }

    function renderScene() {
      try {
        ctx.clearRect(0, 0, width, height);
        time += 0.7;
        // Multi-layer subtle gold glass bands (Strictly NO drops or particles)
        // Background soft glass ribbon
        drawSubtleGlassLayer({
          yRatio: 0.48, amplitude: 18, freq: 0.003, speed: 0.007,
          thickness: 42, opacity: 0.35, phaseOffset: 0
        });
        // Main polished central glass ribbon
        drawSubtleGlassLayer({
          yRatio: 0.51, amplitude: 22, freq: 0.0025, speed: 0.010,
          thickness: 28, opacity: 0.68, phaseOffset: 1.5
        });
        // Foreground delicate glass accent strand
        drawSubtleGlassLayer({
          yRatio: 0.53, amplitude: 14, freq: 0.0038, speed: 0.012,
          thickness: 14, opacity: 0.50, phaseOffset: 3.2
        });
        animationFrameId = requestAnimationFrame(renderScene);
      } catch (e) {
        animationFrameId = requestAnimationFrame(renderScene);
      }
    }

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    renderScene();

    function postMsg(msg) {
      try {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(msg);
        }
      } catch (e) {}
    }
    document.getElementById('btnStart').addEventListener('click', function() { postMsg('navigate:onboarding'); });
    document.getElementById('btnLogin').addEventListener('click', function() { postMsg('navigate:login'); });
  })();
</script>
</body>
</html>`;
