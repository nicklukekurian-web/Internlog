// Retro pixel-star canvas background (vanilla JS port, no dependencies)
(function () {
  const STAR_COLORS = ["#FFFFFF", "#FFFFAA", "#AAAAFF", "#FFAAAA", "#AAFFAA", "#FFAAFF", "#AAFFFF"];
  const starDensity = 0.00012;
  const twinkleProbability = 0.7;
  const minTwinkleSpeed = 2;
  const maxTwinkleSpeed = 4;
  const pixelSize = 3;
  const targetFps = 16;
  const shootingStarPixelSize = 2;

  function initStars(container) {
    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '1';
    container.style.position = container.style.position || 'relative';
    container.prepend(canvas);

    const ctx = canvas.getContext('2d');
    let backgroundStars = [];
    let shootingStars = [];
    let lastRender = 0;
    const frameInterval = 1000 / targetFps;

    function resize() {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      initBackgroundStars();
    }

    function makeStar(gridX, gridY) {
      const baseOpacity = Math.random() * 0.5 + 0.5;
      return {
        x: gridX, y: gridY,
        color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
        baseOpacity, currentOpacity: baseOpacity,
        twinkle: Math.random() < twinkleProbability,
        twinkleSpeed: minTwinkleSpeed + Math.random() * (maxTwinkleSpeed - minTwinkleSpeed),
        twinkleDirection: -1,
        twinkleTimer: 0
      };
    }

    function initBackgroundStars() {
      backgroundStars = [];
      const area = canvas.width * canvas.height;
      const numStars = Math.floor(area * starDensity);
      for (let i = 0; i < numStars; i++) {
        const gridX = Math.floor(Math.random() * (canvas.width / pixelSize)) * pixelSize;
        const gridY = Math.floor(Math.random() * (canvas.height / pixelSize)) * pixelSize;
        backgroundStars.push(makeStar(gridX, gridY));
      }
    }

    function regenerateSome() {
      const numToRegen = Math.max(1, Math.floor(backgroundStars.length * 0.15));
      for (let i = 0; i < numToRegen; i++) {
        const idx = Math.floor(Math.random() * backgroundStars.length);
        const gridX = Math.floor(Math.random() * (canvas.width / pixelSize)) * pixelSize;
        const gridY = Math.floor(Math.random() * (canvas.height / pixelSize)) * pixelSize;
        backgroundStars[idx] = makeStar(gridX, gridY);
      }
    }

    function createShootingStar() {
      const x = Math.random() * canvas.width;
      const angle = 45 + Math.random() * 90;
      shootingStars.push({ x, y: 0, angle, speed: Math.random() * 5 + 8, distance: 0, trail: [] });
      setTimeout(createShootingStar, Math.random() * 4000 + 2000);
    }

    function frame(timestamp) {
      if (timestamp - lastRender < frameInterval) {
        requestAnimationFrame(frame);
        return;
      }
      lastRender = timestamp;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      backgroundStars.forEach(star => {
        ctx.fillStyle = star.color;
        ctx.globalAlpha = star.currentOpacity;
        ctx.fillRect(star.x, star.y, pixelSize, pixelSize);
        if (star.twinkle) {
          star.twinkleTimer += 1 / targetFps;
          if (star.twinkleTimer >= star.twinkleSpeed) { star.twinkleTimer = 0; star.twinkleDirection *= -1; }
          const progress = star.twinkleTimer / star.twinkleSpeed;
          star.currentOpacity = progress < 0.5
            ? (star.twinkleDirection < 0 ? star.baseOpacity : star.baseOpacity * 0.3)
            : (star.twinkleDirection < 0 ? star.baseOpacity * 0.3 : star.baseOpacity);
        }
      });

      shootingStars = shootingStars.map(star => {
        const rad = (star.angle * Math.PI) / 180;
        const newX = star.x + star.speed * Math.cos(rad);
        const newY = star.y + star.speed * Math.sin(rad);
        const newDistance = star.distance + star.speed;
        const newTrail = [...star.trail];
        if (newDistance % 8 < star.speed) newTrail.push({ x: star.x, y: star.y, opacity: 1.0 });
        const updatedTrail = newTrail.map(p => ({ ...p, opacity: p.opacity - 0.1 })).filter(p => p.opacity > 0);
        return { ...star, x: newX, y: newY, distance: newDistance, trail: updatedTrail };
      }).filter(star => star.x >= -30 && star.x <= canvas.width + 30 && star.y >= -30 && star.y <= canvas.height + 30);

      shootingStars.forEach(star => {
        star.trail.forEach(point => {
          ctx.globalAlpha = point.opacity;
          ctx.fillStyle = 'rgba(180, 242, 255, 1)';
          ctx.fillRect(point.x, point.y, shootingStarPixelSize, shootingStarPixelSize);
        });
        ctx.globalAlpha = 1.0;
        ctx.fillStyle = '#ffffff';
        for (let y = 0; y < 2; y++) {
          for (let x = 0; x < 4; x++) {
            if ((x === 0 && y === 1) || (x === 3 && y === 0)) continue;
            ctx.fillRect(star.x + x * shootingStarPixelSize, star.y + y * shootingStarPixelSize, shootingStarPixelSize, shootingStarPixelSize);
          }
        }
      });

      requestAnimationFrame(frame);
    }

    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(frame);
    createShootingStar();
    setInterval(regenerateSome, 5000);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const hero = document.querySelector('.hero-dark');
    if (hero) initStars(hero);
  });
})();