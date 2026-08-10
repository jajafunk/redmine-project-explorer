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
    const showClosedKey = `rpe:showClosed:${pid}`;
    const statusKey = `rpe:statuses:${pid}`;
    const priorityKey = `rpe:priorities:${pid}`;
    const childCountKey = `rpe:showChildCounts:${pid}`;

    const search = document.getElementById('ticket-tree-search');
    const sort = document.getElementById('ticket-tree-sort');
    const count = document.getElementById('ticket-tree-result-count');
    const auto = document.getElementById('ticket-tree-auto-refresh');
    const showClosed = document.getElementById('ticket-tree-show-closed');
    const contextMenu = document.getElementById('ticket-tree-context-menu');
    const exportButton = document.getElementById('ticket-tree-export-html');

    const optionsButton = document.getElementById('ticket-tree-options-button');
    const optionsMenu = document.getElementById('ticket-tree-options-menu');
    const statusOptions = document.getElementById('ticket-tree-status-options');
    const priorityOptions = document.getElementById('ticket-tree-priority-options');
    const resetButton = document.getElementById('ticket-tree-options-reset');
    const showChildCounts = document.getElementById('ticket-tree-show-child-counts');

    let current = null;
    let timer = null;
    let selected = null;

    const details = () =>
      [...root.querySelectorAll('details[id^="ticket-tree-issue-"]')];

    const nodes = () =>
      [...root.querySelectorAll('li.ticket-tree-node')];

    function loadJson(key, fallback) {
      try {
        const value = JSON.parse(localStorage.getItem(key));
        return value ?? fallback;
      } catch (_) {
        return fallback;
      }
    }

    function saveExpanded() {
      localStorage.setItem(
        expandKey,
        JSON.stringify(details().filter((d) => d.open).map((d) => d.id))
      );
    }

    function loadExpanded() {
      const saved = loadJson(expandKey, null);
      if (!Array.isArray(saved)) return;

      const set = new Set(saved);
      details().forEach((detail) => {
        detail.open = set.has(detail.id);
      });
    }

    function uniqueOptions(idField, nameField, closedField = null) {
      const map = new Map();

      nodes().forEach((node) => {
        const id = node.dataset[idField];
        const name = node.dataset[nameField];

        if (!id || !name || map.has(id)) return;

        map.set(id, {
          id,
          name,
          closed: closedField
            ? node.dataset[closedField] === '1'
            : false
        });
      });

      return [...map.values()].sort((a, b) =>
        a.name.localeCompare(b.name, 'ja')
      );
    }

    const statuses = uniqueOptions(
      'statusId',
      'statusName',
      'statusClosed'
    );

    const priorities = uniqueOptions(
      'priorityId',
      'priorityName'
    );

    function storedSelection(key, options) {
      const saved = loadJson(key, null);
      const validIds = new Set(options.map((item) => item.id));

      if (!Array.isArray(saved)) {
        return new Set(options.map((item) => item.id));
      }

      return new Set(saved.filter((id) => validIds.has(id)));
    }

    let selectedStatuses = storedSelection(statusKey, statuses);
    let selectedPriorities = storedSelection(priorityKey, priorities);

    function createCheckbox(container, prefix, item, checked, isClosed) {
      const label = document.createElement('label');
      label.className = 'ticket-tree-option-row';
      if (isClosed) label.dataset.closedStatus = '1';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = item.id;
      input.id = `${prefix}-${item.id}`;
      input.checked = checked;

      const text = document.createTextNode(` ${item.name}`);

      label.appendChild(input);
      label.appendChild(text);
      container.appendChild(label);

      return input;
    }

    function buildFilterOptions() {
      statusOptions.replaceChildren();
      priorityOptions.replaceChildren();

      statuses.forEach((status) => {
        const input = createCheckbox(
          statusOptions,
          'ticket-tree-status',
          status,
          selectedStatuses.has(status.id),
          status.closed
        );

        input.addEventListener('change', () => {
          if (input.checked) {
            selectedStatuses.add(status.id);
          } else {
            selectedStatuses.delete(status.id);
          }

          localStorage.setItem(
            statusKey,
            JSON.stringify([...selectedStatuses])
          );

          applyFilters();
        });
      });

      priorities.forEach((priority) => {
        const input = createCheckbox(
          priorityOptions,
          'ticket-tree-priority',
          priority,
          selectedPriorities.has(priority.id),
          false
        );

        input.addEventListener('change', () => {
          if (input.checked) {
            selectedPriorities.add(priority.id);
          } else {
            selectedPriorities.delete(priority.id);
          }

          localStorage.setItem(
            priorityKey,
            JSON.stringify([...selectedPriorities])
          );

          applyFilters();
        });
      });

      updateClosedStatusOptions();
    }

    function updateClosedStatusOptions() {
      statusOptions
        .querySelectorAll('[data-closed-status="1"]')
        .forEach((row) => {
          row.hidden = !showClosed.checked;
        });
    }

    function directChildren(node) {
      return [
        ...node.querySelectorAll(
          ':scope > details > ul > li.ticket-tree-node'
        )
      ];
    }

    function nodeMatches(node, term) {
      const textMatches =
        !term || (node.dataset.searchText || '').includes(term);

      const isClosed = node.dataset.statusClosed === '1';

      const closedMatches =
        showClosed.checked || !isClosed;

      const statusMatches =
        selectedStatuses.has(node.dataset.statusId);

      const priorityId = node.dataset.priorityId || '';
      const priorityMatches =
        priorityId === '' || selectedPriorities.has(priorityId);

      return (
        textMatches &&
        closedMatches &&
        statusMatches &&
        priorityMatches
      );
    }

    function filterNode(node, term) {
      const childMatches = directChildren(node)
        .map((child) => filterNode(child, term))
        .some(Boolean);

      const ownMatches = nodeMatches(node, term);
      const visible = ownMatches || childMatches;

      node.hidden = !visible;

      if (childMatches) {
        const detail = node.querySelector(':scope > details');
        if (detail) detail.open = true;
      }

      return visible;
    }

    function visibleDescendantCount(node) {
      return directChildren(node).reduce((total, child) => {
        if (child.hidden) return total;
        return total + 1 + visibleDescendantCount(child);
      }, 0);
    }

    function updateChildCounts() {
      const enabled = showChildCounts.checked;

      nodes().forEach((node) => {
        const label = node.querySelector(
          ':scope > details > summary [data-child-count-for], :scope > .ticket-tree-leaf [data-child-count-for]'
        );
        if (!label) return;

        label.hidden = !enabled;
        label.textContent = enabled
          ? ` (${visibleDescendantCount(node)})`
          : '';
      });
    }

    function exportVisibleIssueIds() {
      const evaluate = (node) => {
        const childMatches = directChildren(node)
          .map((child) => evaluate(child))
          .some(Boolean);
        const ownMatches = nodeMatches(node, '');
        return ownMatches || childMatches;
      };

      return nodes()
        .filter((node) => evaluate(node))
        .map((node) => node.dataset.issueId);
    }

    function applyFilters() {
      const term = search.value.trim().toLowerCase();

      [...root.querySelectorAll(':scope > li.ticket-tree-node')]
        .forEach((node) => filterNode(node, term));

      const visibleCount = nodes()
        .filter((node) => !node.hidden)
        .length;

      const filtering =
        term ||
        !showClosed.checked ||
        selectedStatuses.size !== statuses.length ||
        selectedPriorities.size !== priorities.length;

      count.textContent = filtering
        ? `${visibleCount}件を表示`
        : '';

      updateChildCounts();
    }

    function refresh(on) {
      auto.checked = on;
      localStorage.setItem(refreshKey, on ? '1' : '0');

      if (timer) clearInterval(timer);

      if (on) {
        timer = setInterval(() => {
          if (
            document.visibilityState === 'visible' &&
            !search.value
          ) {
            location.reload();
          }
        }, Number(app.dataset.refreshSeconds || 60) * 1000);
      }
    }

    function hideContextMenu() {
      contextMenu.hidden = true;
      current = null;
    }

    function showContextMenu(event, node) {
      event.preventDefault();
      current = node;
      contextMenu.hidden = false;

      contextMenu.querySelector('[data-action=edit]').hidden =
        !node.dataset.editUrl;

      contextMenu.querySelector('[data-action=child]').hidden =
        !node.dataset.childUrl;

      contextMenu.style.left =
        `${Math.max(0, Math.min(event.clientX, innerWidth - 210))}px`;

      contextMenu.style.top =
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
        selected?.dataset.exportUrl ||
        exportButton.dataset.exportUrl;

      if (!exportUrl) return;

      const label = selected
        ? `#${selected.dataset.issueId} 以下`
        : 'プロジェクト全体';

      if (
        !confirm(
          `${label}をHTML一式に書き出します。よろしいですか？`
        )
      ) {
        return;
      }

      const original = exportButton.textContent;
      exportButton.disabled = true;
      exportButton.textContent = '書き出し中…';

      try {
        const token =
          document.querySelector(
            'meta[name="csrf-token"]'
          )?.content || '';

        const body = new URLSearchParams();
        body.set('issue_ids', exportVisibleIssueIds().join(','));
        body.set('show_child_counts', showChildCounts.checked ? '1' : '0');

        const response = await fetch(exportUrl, {
          method: 'POST',
          headers: {
            'X-CSRF-Token': token,
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            Accept: 'application/zip'
          },
          credentials: 'same-origin',
          body: body.toString()
        });

        if (!response.ok) {
          throw new Error(
            (await response.text()) ||
            `HTTP ${response.status}`
          );
        }

        const blob = await response.blob();
        const disposition =
          response.headers.get('Content-Disposition') || '';

        const match =
          disposition.match(/filename="?([^";]+)"?/i);

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
        alert(
          `HTML書き出しに失敗しました。\n${error.message}`
        );
      } finally {
        exportButton.disabled = false;
        exportButton.textContent = original;
      }
    }

    function toggleOptionsMenu(open) {
      optionsMenu.hidden = !open;
      optionsButton.setAttribute(
        'aria-expanded',
        String(open)
      );
    }

    details().forEach((detail) =>
      detail.addEventListener('toggle', saveExpanded)
    );

    root.addEventListener('click', (event) => {
      const node =
        event.target.closest('li.ticket-tree-node');

      if (node) selectNode(node);
    });

    root.addEventListener('contextmenu', (event) => {
      const node =
        event.target.closest('li.ticket-tree-node');

      if (node) showContextMenu(event, node);
    });

    contextMenu.addEventListener('click', async (event) => {
      const action = event.target.dataset.action;
      if (!action || !current) return;

      const url = current.dataset.issueUrl;

      if (action === 'open') location.href = url;
      if (action === 'edit') location.href = current.dataset.editUrl;
      if (action === 'child') location.href = current.dataset.childUrl;

      if (action === 'copy') {
        const absolute =
          new URL(url, location.origin).href;

        try {
          await navigator.clipboard.writeText(absolute);
        } catch (_) {
          prompt('このリンクをコピーしてください', absolute);
        }
      }

      hideContextMenu();
    });

    optionsButton.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleOptionsMenu(optionsMenu.hidden);
    });

    optionsMenu.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    document.addEventListener('click', () => {
      hideContextMenu();
      toggleOptionsMenu(false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        hideContextMenu();
        toggleOptionsMenu(false);
        clearSelection();
      }
    });

    document
      .getElementById('ticket-tree-expand-all')
      .addEventListener('click', () => {
        details().forEach((detail) => {
          detail.open = true;
        });
        saveExpanded();
      });

    document
      .getElementById('ticket-tree-collapse-all')
      .addEventListener('click', () => {
        details().forEach((detail) => {
          detail.open = false;
        });
        saveExpanded();
      });

    auto.addEventListener('change', () =>
      refresh(auto.checked)
    );

    showClosed.addEventListener('change', () => {
      localStorage.setItem(
        showClosedKey,
        showClosed.checked ? '1' : '0'
      );

      updateClosedStatusOptions();
      applyFilters();
    });

    resetButton.addEventListener('click', () => {
      localStorage.removeItem(refreshKey);
      localStorage.removeItem(showClosedKey);
      localStorage.removeItem(statusKey);
      localStorage.removeItem(priorityKey);
      localStorage.removeItem(childCountKey);

      selectedStatuses =
        new Set(statuses.map((item) => item.id));

      selectedPriorities =
        new Set(priorities.map((item) => item.id));

      showClosed.checked = true;
      showChildCounts.checked = false;
      refresh(false);
      buildFilterOptions();
      applyFilters();
    });

    showChildCounts.addEventListener('change', () => {
      localStorage.setItem(
        childCountKey,
        showChildCounts.checked ? '1' : '0'
      );
      updateChildCounts();
    });

    exportButton.addEventListener('click', exportHtml);
    search.addEventListener('input', applyFilters);

    sort.addEventListener('change', () => {
      const url = new URL(location.href);
      url.searchParams.set('sort', sort.value);
      location.href = url;
    });

    showClosed.checked =
      localStorage.getItem(showClosedKey) !== '0';
    showChildCounts.checked =
      localStorage.getItem(childCountKey) === '1';

    buildFilterOptions();
    loadExpanded();
    refresh(localStorage.getItem(refreshKey) === '1');
    applyFilters();
  }

  document.addEventListener('DOMContentLoaded', init);
  document.addEventListener('turbo:load', init);
})();
