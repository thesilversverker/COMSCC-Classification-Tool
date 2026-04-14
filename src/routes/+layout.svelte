<slot />

<footer class="site-footer">
  <!-- Logical component: inner width matches `main` in +page.svelte (1080px + 1rem horizontal padding). -->
  <div class="site-footer-inner">
    <p class="site-footer-line">
      <span class="site-footer-title">COMSCC Classification Tool</span>
      <span class="site-footer-sep" aria-hidden="true">·</span>
      <span>v0.1.0</span>
    </p>
    <p class="site-footer-line site-footer-meta">© 2026 COMSCC-Classification-Tool — MIT License</p>
    <p class="site-footer-line site-footer-meta">
      <a class="site-footer-link" href="https://github.com/thesilversverker/COMSCC-Classification-Tool"
        >github.com/thesilversverker/COMSCC-Classification-Tool</a
      >
    </p>
  </div>
</footer>

<style>
  .site-footer {
    margin-top: 1rem;
    border-top: 1px solid #e5e5e5;
    font-family: system-ui, sans-serif;
    min-width: 0;
  }
  .site-footer-inner {
    box-sizing: border-box;
    max-width: 1080px;
    margin: 0 auto;
    padding: 0.35rem 1rem 0.65rem;
  }
  .site-footer-line {
    margin: 0;
    font-size: 0.65rem;
    line-height: 1.35;
    color: #888;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .site-footer-line + .site-footer-line {
    margin-top: 0.15rem;
  }
  .site-footer-title {
    color: #666;
    font-weight: 600;
  }
  .site-footer-sep {
    margin: 0 0.2rem;
    color: #bbb;
    font-weight: 400;
  }
  .site-footer-meta {
    font-size: 0.62rem;
  }
  .site-footer-link {
    color: #6b7cc4;
    text-decoration: none;
  }
  .site-footer-link:hover {
    text-decoration: underline;
  }
</style>
