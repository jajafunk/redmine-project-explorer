(() => {
  'use strict';

  function init() {
    const app = document.getElementById('ticket-tree-app');
    const root = document.getElementById('ticket-tree-root');

    if (!app || !root || app.dataset.initialized === 'true') return;
    app.dataset.initialized = 'true';

    const pid = app.dataset.projectId;
    const expandKey = `rpe:expanded:${pid}`;
    const refreshKey = `rpe:refresh:${pid}`;
    const search = document.getElementById('ticket-tree-search');
    const sort = document.getElementById('ticket-tree-sort');
    const count = document.getElementById('ticket-tree-result-count');
    const auto = document.getElementById('ticket-tree-auto-refresh');
    const menu = document.getElementById('ticket-tree-context-menu');
    const exportButton = document.getElementById('ticket-tree-export-html');

    let current = null;
    let timer = null;
    let selected = null;

    const details = () =>
      [...root.querySelectorAll('details[id^="ticket-tree-issue-"]')];

    function save() {
      localStorage.setItem(
        expandKey,
        JSON.stringify(details().filter((d) => d.open).map((d) => d.id))
      );
    }

    function load() {
      try {
        const saved = JSON.parse(localStorage.getItem(expandKey));
        if (Array.isArray(saved)) {
          const set = new Set(saved);
          details().forEach((d) => {
            d.open = set.has(d.id);
          });
        }
      } catch (error) {
        // 保存値が壊れている場合は無視する
      }
    }

    function children(node) {
      return [
        ...node.querySelectorAll(
          ':scope > details > ul > li.ticket-tree-node'
        )
      ];
    }

    function filter(node, term) {
      const own = (node.dataset.searchText || '').includes(term);
      const child = children(node).map((item) => filter(item, term)).some(Boolean);
      const visible = own || child;

      node.hidden = !visible;

      if (term && child) {
        const detail = node.querySelector(':scope > details');
        if (detail) detail.open = true;
      }

      return visible;
    }

    function apply() {
      const term = search.value.trim().toLowerCase();

      [...root.querySelectorAll(':scope > li.ticket-tree-node')].forEach(
        (node) => filter(node, term)
      );

      let visible = 0;
      root.querySelectorAll('li.ticket-tree-node').forEach((node) => {
        if (!node.hidden) visible += 1;
      });

      count.textContent = term ? `${visible}件を表示` : '';
    }

    function refresh(on) {
      auto.checked = on;
      localStorage.setItem(refreshKey, on ? '1' : '0');

      if (timer) clearInterval(timer);

      if (on) {
        timer = setInterval(() => {
          if (document.visibilityState === 'visible' && !search.value) {
            location.reload();
          }
        }, Number(app.dataset.refreshSeconds || 60) * 1000);
      }
    }

    function hide() {
      menu.hidden = true;
      current = null;
    }

    function show(event, node) {
      event.preventDefault();
      current = node;
      menu.hidden = false;
      menu.querySelector('[data-action=edit]').hidden = !node.dataset.editUrl;
      menu.querySelector('[data-action=child]').hidden = !node.dataset.childUrl;
      menu.style.left =
        `${Math.max(0, Math.min(event.clientX, innerWidth - 210))}px`;
      menu.style.top =
        `${Math.max(0, Math.min(event.clientY, innerHeight - 170))}px`;
    }

    function clearSelection() {
      if (selected) {
        selected.classList.remove('ticket-tree-selected');
      }

      selected = null;
      exportButton.textContent = '全体をHTML書き出し';
    }

    function selectNode(node) {
      if (selected === node) {
        clearSelection();
        return;
      }

      if (selected) {
        selected.classList.remove('ticket-tree-selected');
      }

      selected = node;
      selected.classList.add('ticket-tree-selected');
      exportButton.textContent =
        `#${node.dataset.issueId} 以下をHTML書き出し`;
    }

    async function exportHtml() {
      const exportUrl =
        selected?.dataset.exportUrl || exportButton.dataset.exportUrl;

      if (!exportUrl) return;

      const label = selected
        ? `#${selected.dataset.issueId} 以下`
        : 'プロジェクト全体';

      if (!confirm(`${label}をHTML一式に書き出します。よろしいですか？`)) {
        return;
      }

      const original = exportButton.textContent;
      exportButton.disabled = true;
      exportButton.textContent = '書き出し中…';

      try {
        const token =
          document.querySelector('meta[name="csrf-token"]')?.content || '';

        const response = await fetch(exportUrl, {
          method: 'POST',
          headers: {
            'X-CSRF-Token': token,
            Accept: 'application/zip'
          },
          credentials: 'same-origin'
        });

        if (!response.ok) {
          throw new Error(await response.text() || `HTTP ${response.status}`);
        }

        const blob = await response.blob();
        const disposition = response.headers.get('Content-Disposition') || '';
        const match = disposition.match(/filename="?([^";]+)"?/i);
        const filename = match
          ? match[1]
          : selected
            ? `project-explorer-issue-${selected.dataset.issueId}.zip`
            : 'project-explorer-all.zip';

        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');

        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
      } catch (error) {
        alert(`HTML書き出しに失敗しました。\n${error.message}`);
      } finally {
        exportButton.disabled = false;
        exportButton.textContent = original;
      }
    }

    details().forEach((detail) => detail.addEventListener('toggle', save));

    root.addEventListener('click', (event) => {
      const node = event.target.closest('li.ticket-tree-node');
      if (node) selectNode(node);
    });

    root.addEventListener('contextmenu', (event) => {
      const node = event.target.closest('li.ticket-tree-node');
      if (node) show(event, node);
    });

    menu.addEventListener('click', async (event) => {
      const action = event.target.dataset.action;
      if (!action || !current) return;

      const url = current.dataset.issueUrl;

      if (action === 'open') location.href = url;
      if (action === 'edit') location.href = current.dataset.editUrl;
      if (action === 'child') location.href = current.dataset.childUrl;

      if (action === 'copy') {
        const absolute = new URL(url, location.origin).href;

        try {
          await navigator.clipboard.writeText(absolute);
        } catch (error) {
          prompt('このリンクをコピーしてください', absolute);
        }
      }

      hide();
    });

    document.addEventListener('click', (event) => {
      if (!menu.contains(event.target)) hide();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        hide();
        clearSelection();
      }
    });

    document
      .getElementById('ticket-tree-expand-all')
      .addEventListener('click', () => {
        details().forEach((detail) => {
          detail.open = true;
        });
        save();
      });

    document
      .getElementById('ticket-tree-collapse-all')
      .addEventListener('click', () => {
        details().forEach((detail) => {
          detail.open = false;
        });
        save();
      });

    exportButton.addEventListener('click', exportHtml);
    search.addEventListener('input', apply);

    sort.addEventListener('change', () => {
      const url = new URL(location.href);
      url.searchParams.set('sort', sort.value);
      location.href = url;
    });

    auto.addEventListener('change', () => refresh(auto.checked));

    load();
    refresh(localStorage.getItem(refreshKey) === '1');
  }

  document.addEventListener('DOMContentLoaded', init);
  document.addEventListener('turbo:load', init);
})();
