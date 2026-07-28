// Raw HTML/Canvas Welcome Screen — rendered inside a WebView.
// Buttons post messages back to the native app via window.ReactNativeWebView.postMessage.
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
  /* Warm brown/gold ambient corner glow */
  .ambient-glow {
    position: absolute;
    bottom: -80px; right: -80px;
    width: 320px; height: 320px;
    border-radius: 9999px;
    filter: blur(48px);
    opacity: 0.70;
    background: radial-gradient(circle, rgba(222,170,85,0.08) 0%, rgba(166,124,82,0.03) 45%, rgba(9,9,8,0) 70%);
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
    var BOKEH_COUNT = 24;
    var bokehParticles = [];

    function initGoldGlassElements() {
      bokehParticles = [];
      var w = width || window.innerWidth || 393;
      var h = height || window.innerHeight || 852;
      for (var i = 0; i < BOKEH_COUNT; i++) {
        bokehParticles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          radius: Math.random() * 6 + 2,
          alpha: Math.random() * 0.2 + 0.05,
          speedY: -(Math.random() * 0.16 + 0.05),
          speedX: (Math.random() - 0.5) * 0.1,
          pulseSpeed: Math.random() * 0.015 + 0.005
        });
      }
    }

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
        initGoldGlassElements();
      } catch (e) {}
    }

    function drawGoldGlassRibbon(layerIndex, config) {
      var yBase = config.yBase, heightAmp = config.heightAmp, freq = config.freq;
      var speed = config.speed, thickness = config.thickness, opacity = config.opacity;
      var pointsTop = [], pointsBottom = [];
      var stepX = 6;
      for (var x = -20; x <= width + 20; x += stepX) {
        var normX = x / Math.max(1, width);
        var baseArc = Math.sin(normX * Math.PI) * 40;
        var wave1 = Math.sin(x * freq + time * speed + layerIndex) * heightAmp;
        var wave2 = Math.cos(x * freq * 1.5 - time * speed * 0.7) * (heightAmp * 0.35);
        var centerY = yBase + baseArc + wave1 + wave2;
        var dynamicThickness = thickness + Math.sin(normX * Math.PI * 2 + time * 0.002) * (thickness * 0.3);
        pointsTop.push({ x: x, y: centerY - dynamicThickness / 2 });
        pointsBottom.push({ x: x, y: centerY + dynamicThickness / 2 });
      }
      ctx.beginPath();
      ctx.moveTo(pointsTop[0].x, pointsTop[0].y);
      for (var i = 1; i < pointsTop.length; i++) ctx.lineTo(pointsTop[i].x, pointsTop[i].y);
      for (var j = pointsBottom.length - 1; j >= 0; j--) ctx.lineTo(pointsBottom[j].x, pointsBottom[j].y);
      ctx.closePath();
      var glassFillGrad = ctx.createLinearGradient(0, yBase - 50, width, yBase + 70);
      glassFillGrad.addColorStop(0, 'rgba(238,215,171,' + (opacity * 0.08) + ')');
      glassFillGrad.addColorStop(0.35, 'rgba(244,210,143,' + (opacity * 0.32) + ')');
      glassFillGrad.addColorStop(0.7, 'rgba(222,170,85,' + (opacity * 0.25) + ')');
      glassFillGrad.addColorStop(1, 'rgba(180,120,40,' + (opacity * 0.04) + ')');
      ctx.fillStyle = glassFillGrad;
      ctx.fill();

      ctx.save();
      ctx.clip();
      var sheenX = ((time * 28 + layerIndex * 110) % (Math.max(1, width) * 2.2)) - width * 0.6;
      var causticGrad = ctx.createLinearGradient(sheenX, yBase - 80, sheenX + 85, yBase + 80);
      causticGrad.addColorStop(0, 'rgba(255,255,255,0)');
      causticGrad.addColorStop(0.4, 'rgba(255,248,220,0.28)');
      causticGrad.addColorStop(0.5, 'rgba(255,255,255,0.5)');
      causticGrad.addColorStop(0.6, 'rgba(244,210,143,0.2)');
      causticGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = causticGrad;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();

      ctx.beginPath();
      ctx.moveTo(pointsTop[0].x, pointsTop[0].y);
      for (var k = 1; k < pointsTop.length; k++) ctx.lineTo(pointsTop[k].x, pointsTop[k].y);
      var topRimGrad = ctx.createLinearGradient(0, 0, width, 0);
      topRimGrad.addColorStop(0, 'rgba(238,215,171,0)');
      topRimGrad.addColorStop(0.2, 'rgba(255,250,230,0.65)');
      topRimGrad.addColorStop(0.5, 'rgba(244,210,143,0.85)');
      topRimGrad.addColorStop(0.8, 'rgba(222,170,85,0.55)');
      topRimGrad.addColorStop(1, 'rgba(238,215,171,0)');
      ctx.strokeStyle = topRimGrad;
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }

    function renderScene() {
      try {
        ctx.clearRect(0, 0, width, height);
        time += 0.8;
        for (var i = 0; i < bokehParticles.length; i++) {
          var p = bokehParticles[i];
          p.y += p.speedY;
          p.x += p.speedX;
          if (p.y < -20) p.y = height + 20;
          if (p.x < -20) p.x = width + 20;
          if (p.x > width + 20) p.x = -20;
          var currentAlpha = Math.max(0.02, p.alpha + Math.sin(time * p.pulseSpeed) * 0.08);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          var bGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);
          bGrad.addColorStop(0, 'rgba(255,245,210,' + (currentAlpha * 1.4) + ')');
          bGrad.addColorStop(0.5, 'rgba(244,210,143,' + currentAlpha + ')');
          bGrad.addColorStop(1, 'rgba(222,170,85,0)');
          ctx.fillStyle = bGrad;
          ctx.fill();
        }
        drawGoldGlassRibbon(1, { yBase: height * 0.49, heightAmp: 20, freq: 0.0035, speed: 0.008, thickness: 44, opacity: 0.38 });
        drawGoldGlassRibbon(2, { yBase: height * 0.51, heightAmp: 25, freq: 0.0028, speed: 0.012, thickness: 32, opacity: 0.72 });
        drawGoldGlassRibbon(3, { yBase: height * 0.53, heightAmp: 16, freq: 0.0042, speed: 0.015, thickness: 15, opacity: 0.58 });
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
