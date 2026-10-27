"use strict";

(() => {
  const nav = document.getElementById("nav");
  const onScroll = () => {
    if (!nav) return;
    nav.classList.toggle("is-scrolled", window.scrollY > 12);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduceMotion && "IntersectionObserver" in window) {
    const items = Array.from(document.querySelectorAll("[data-reveal]"));
    items.forEach((item, index) => {
      item.classList.add("will-reveal");
      item.style.transitionDelay = `${Math.min(index % 4, 3) * 55}ms`;
    });
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    items.forEach((item) => observer.observe(item));
  }
})();
