window.GED_FILTERS={filterBy:function(items,q,indexes){q=(q||'').toLowerCase();return !q?items:items.filter(x=>indexes.some(i=>String(x[i]).toLowerCase().includes(q)))}};
