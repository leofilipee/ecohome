// Dados para os charts (inicialmente vazios — sem equipamentos por padrão)
const pieLabels = [];
const originalColors = ['#00c48c','#3b82f6','#f59e0b','#8b5cf6','#ff6b95','#6b7280'];
const pieData = {
    labels: pieLabels,
    datasets: [{
        data: [],
        backgroundColor: originalColors.slice(),
        hoverBackgroundColor: originalColors.slice(),
        borderWidth: 0
    }]
};

const barData = {
    labels: ['Sem 1','Sem 2','Sem 3','Sem 4'],
    datasets: [
        {
            label: 'Consumo Real',
            data: [200,180,220,190],
            backgroundColor: '#3b82f6',
            borderRadius:6
        },
        {
            label: 'Objetivo',
            data: [190,185,200,200],
            backgroundColor: 'rgba(59,130,246,0.18)'
        }
    ]
};

function darkenColor(col, amount){
    // amount in 0..1 where 0 no change, 0.2 darken 20%
    if(!col) return col;
    col = String(col).trim();
    // hex format
    if(col[0] === '#'){
        const c = col.replace('#','');
        // support shorthand hex (#abc)
        const full = c.length === 3 ? c.split('').map(ch=> ch+ch).join('') : c;
        const num = parseInt(full,16);
        if(isNaN(num)) return col;
        let r = (num >> 16) & 0xFF;
        let g = (num >> 8) & 0xFF;
        let b = num & 0xFF;
        r = Math.max(0, Math.floor(r*(1-amount)));
        g = Math.max(0, Math.floor(g*(1-amount)));
        b = Math.max(0, Math.floor(b*(1-amount)));
        return '#'+( (1<<24) + (r<<16) + (g<<8) + b ).toString(16).slice(1);
    }
    // hsl(...) format — support both comma and space separators
    const hslMatch = col.match(/hsl\(\s*([\d.]+)(?:deg)?(?:\s*[,\s]\s*)?([\d.]+)%?(?:\s*[,\s]\s*)?([\d.]+)%?\s*\)/i);
    if(hslMatch){
        let h = Number(hslMatch[1]);
        const s = Number(hslMatch[2]);
        let l = Number(hslMatch[3]);
        if(isNaN(h) || isNaN(s) || isNaN(l)) return col;
        l = Math.max(0, Math.min(100, l * (1 - amount)));
        // return with commas for broader compatibility
        return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Number(l.toFixed(2))}%)`;
    }
    // unknown format: attempt to return original
    return col;
}

function applyDimToPie(chart, highlightIndex){
    const amt = 0.2; // 20% darker for non-highlighted
    const baseColors = (chart && chart._baseColors && chart._baseColors.slice()) || originalColors.slice();
    const newColors = baseColors.map((c,i)=> i===highlightIndex ? c : darkenColor(c, amt));
    // preparar bordas: todos 0 por padrão, highlighted ganha borda mais escura
    const borderWidths = baseColors.map((c,i)=> i===highlightIndex ? 3 : 0);
    const borderColors = baseColors.map((c,i)=> i===highlightIndex ? darkenColor(c, 0.25) : 'rgba(0,0,0,0)');

    chart.data.datasets[0].backgroundColor = newColors;
    chart.data.datasets[0].borderWidth = borderWidths;
    chart.data.datasets[0].borderColor = borderColors;
    // garantir que o hover não altera o preenchimento: manter hoverBackgroundColor sincronizado
    chart.data.datasets[0].hoverBackgroundColor = newColors;
    chart.data.datasets[0].hoverBorderColor = borderColors;
    chart.update('none');
}

function resetPieColors(chart){
    const base = (chart && chart._baseColors && chart._baseColors.slice()) || originalColors.slice();
    chart.data.datasets[0].backgroundColor = base;
    chart.data.datasets[0].borderWidth = base.map(()=>0);
    chart.data.datasets[0].borderColor = base.map(()=> 'rgba(0,0,0,0)');
    chart.data.datasets[0].hoverBackgroundColor = base.slice();
    chart.data.datasets[0].hoverBorderColor = base.map(()=> 'rgba(0,0,0,0)');
    chart.update('none');
}

window.addEventListener('load', ()=>{
    const STORAGE_KEY_MAIN = 'ecohome_equipments_v1';
    let pieChart = null;
    let barChart = null;
    let compareChart = null;

    function getEquipments(){
        try{
            const raw = localStorage.getItem(STORAGE_KEY_MAIN);
            const parsed = raw ? JSON.parse(raw) : null;
            if(Array.isArray(parsed)) return parsed;
        }catch(e){}
        return [];
    }

    function escapeHtml(s){
        if(s === null || s === undefined) return '';
        return String(s).replace(/[&<>"']/g, (c)=> ({'&':'&amp;','<':'&lt;','>':'&gt;', '"':'&quot;',"'":'&#39;'}[c]));
    }

    function getColors(n){
        // Keep the original base palette for the first colors to preserve identity
        const base = originalColors.slice();
        if(n <= base.length) return base.slice(0, n);

        // If more colors needed, append generated HSL colors (do not replace base colors)
        const out = base.slice();
        // start hue offset based on a hash of the base palette to add variation
        let offset = 0;
        try{ offset = Math.floor(parseInt(originalColors[0].replace('#',''),16) % 360); }catch(e){ offset = 0; }
        // tuned saturation/lightness to match perceived brightness of base palette
        const sat = 66; // percent
        const light = 56; // percent
        for(let i=base.length;i<n;i++){
            const hue = Math.round(((i - base.length) * 360 / (n - base.length) + offset) % 360);
            out.push(`hsl(${hue}, ${sat}%, ${light}%)`);
        }
        return out;
    }

    function buildChartDataFromEquipments(equipments){
        const labels = [];
        const values = [];
        equipments.forEach(eq=>{
            const name = eq.name || 'Sem nome';
            const power = parseFloat(String(eq.power||'').replace(/[^0-9\.\-]/g,'')) || 0;
            const hours = parseFloat(String(eq.hours||'').replace(/[^0-9\.\-]/g,'')) || 0;
            const monthlyKwh = (power * hours * 30) / 1000;
            labels.push(name);
            values.push(Number(monthlyKwh.toFixed(2)));
        });
        return {labels, values};
    }

    // Novo: agrega equipamentos por divisão (room). Retorna labels (divisões), valores (kWh) e mapping divisão -> equipamentos[]
    function buildChartDataByRoom(equipments){
        const map = Object.create(null);
        equipments.forEach(eq=>{
            const roomRaw = (eq.room || '').toString().trim();
            const room = roomRaw ? roomRaw : 'Sem divisão';
            const power = parseFloat(String(eq.power||'').replace(/[^0-9\.\-]/g,'')) || 0;
            const hours = parseFloat(String(eq.hours||'').replace(/[^0-9\.\-]/g,'')) || 0;
            const monthlyKwh = Number(((power * hours * 30) / 1000).toFixed(2));
            if(!map[room]) map[room] = { total: 0, items: [] };
            map[room].total += monthlyKwh;
            // keep original item plus computed monthlyKwh
            map[room].items.push(Object.assign({}, eq, { monthlyKwh }));
        });
        const labels = Object.keys(map);
        const values = labels.map(l => Number((map[l].total || 0).toFixed(2)));
        return { labels, values, mapping: map };
    }

    function renderLegend(labels, values, colors){
        const list = document.querySelector('.legend-list');
        if(!list) return;
        list.innerHTML = '';
        // when there are no equipments, show a helpful instruction message
        if(!labels || labels.length === 0){
            list.innerHTML = `<div class="legend-empty">Nenhum equipamento registado. Clica na opção "Adicionar novo equipamento" logo acima para visualizar os seus dados de consumo.</div>`;
            return;
        }
        const total = values.reduce((s,v)=>s+v,0) || 1;
        // ícones por divisão (usado também noutras partes)
        const roomIconsGlobal = {
            'Lavandaria': '🧺',
            'Cozinha': '🍳',
            'Sala': '🛋️',
            'Quarto': '🛏️',
            'Casa de Banho': '🚿',
            'Garagem': '🔌',
            'Exterior': '🌿',
            'Escritório': '💼',
            'Outros': '📦',
            'Sem divisão': '🏠'
        };
        labels.forEach((lab,i)=>{
            const li = document.createElement('li');
            li.setAttribute('data-index', String(i));
            const kwhStr = Number(values[i]).toLocaleString('pt-BR',{minimumFractionDigits:2, maximumFractionDigits:2});
            const icon = roomIconsGlobal[lab] || '⚡';
            li.innerHTML = `
                <div class="legend-left">
                    <span class="legend-icon">${icon}</span>
                    <span class="dot" style="background:${colors[i]}"></span>
                    <div class="legend-text">
                        <span class="legend-name">${escapeHtml(lab)}</span>
                        <span class="legend-kwh">${kwhStr} kWh</span>
                    </div>
                </div>
            `;
            list.appendChild(li);
        });
    }

        // Populate the year filter select based on invoices list
        function populateYearFilter(invoices){
            const sel = document.getElementById('yearFilterSelect');
            if(!sel) return;
            const current = sel.value || '';
            const yearsSet = new Set();
            if(Array.isArray(invoices)){
                invoices.forEach(inv=>{
                    const m = String(inv.month || '').trim();
                    if(!m) return;
                    if(m.indexOf('-') !== -1){
                        const parts = m.split('-');
                        if(parts[0]) yearsSet.add(String(parts[0]));
                    } else {
                        // if input is 'YYYY' or numeric
                        const maybeYear = String(Number(m));
                        if(maybeYear && !isNaN(Number(maybeYear))) yearsSet.add(maybeYear);
                    }
                });
            }
            // build options: sorted years desc (no 'Todos')
            const years = Array.from(yearsSet).map(y=>Number(y)).filter(n=>!isNaN(n)).sort((a,b)=>b-a).map(n=>String(n));
            sel.innerHTML = '';
            if(years.length === 0){
                // if no invoices, default to current year
                const cy = String(new Date().getFullYear());
                const o = document.createElement('option'); o.value = cy; o.textContent = cy; sel.appendChild(o);
                sel.value = cy;
            } else {
                years.forEach(y=>{ const o = document.createElement('option'); o.value = y; o.textContent = y; sel.appendChild(o); });
                // default to most recent year (first in sorted desc) unless current selection exists
                if(current && Array.from(sel.options).some(o=>o.value === current)) sel.value = current; else sel.value = years[0];
            }
            // bind change once
            if(!sel.dataset.bound){
                sel.addEventListener('change', ()=>{ try{ createOrUpdateCharts(); }catch(e){console.warn('chart update failed',e);} });
                sel.dataset.bound = '1';
            }
        }

    function createOrUpdateCharts(){
        const equipments = getEquipments();
        // agora agregamos por divisão (room)
        const roomData = buildChartDataByRoom(equipments);
        const {labels, values, mapping} = roomData;
        const colors = getColors(labels.length || 6);

        // ---- PIE CHART ----
        const pieCtx = document.getElementById('pieChart').getContext('2d');
        const pieDataLocal = {
            labels: labels.length ? labels : pieLabels,
            datasets: [{ data: labels.length ? values : pieData.datasets[0].data, backgroundColor: colors.slice(), borderWidth: 0 }]
        };
        if(!pieChart){
            pieChart = new Chart(pieCtx, {
                type: 'pie',
                data: pieDataLocal,
                options: {
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                title: ()=>'',
                                label: function(ctx){
                                    const v = Number(ctx.parsed || 0);
                                    const dataArr = (ctx.dataset && ctx.dataset.data) ? ctx.dataset.data.map(n=>Number(n||0)) : [];
                                    const total = dataArr.reduce((s,n)=>s+n,0) || 1;
                                    const pct = Math.round((v/total)*100);
                                    const roomName = ctx.label || (ctx.chart && ctx.chart.data && ctx.chart.data.labels && typeof ctx.dataIndex !== 'undefined' ? ctx.chart.data.labels[ctx.dataIndex] : '') || '';
                                    return `${roomName}: ${pct}%`;
                                }
                            }
                        }
                    },
                    responsive: true,
                    maintainAspectRatio: false
                }
            });
        } else {
            pieChart.data = pieDataLocal;
            pieChart.update();
        }
        pieChart._baseColors = pieChart.data.datasets[0].backgroundColor.slice();
        // armazenar mapeamento divisão -> equipamentos no chart para uso no click
        pieChart._roomMapping = mapping || {};
        if(!pieChart._listenersBound){
            pieChart.canvas.addEventListener('mousemove', (e)=>{
                const points = pieChart.getElementsAtEventForMode(e, 'nearest', {intersect:true}, true);
                if(points.length){
                    const idx = points[0].index; applyDimToPie(pieChart, idx);
                } else resetPieColors(pieChart);
            });
            pieChart.canvas.addEventListener('mouseleave', ()=> resetPieColors(pieChart));

            // clique numa fatia -> abrir modal com equipamentos da divisão
            pieChart.canvas.addEventListener('click', (e)=>{
                const pts = pieChart.getElementsAtEventForMode(e, 'nearest', {intersect:true}, true);
                if(!pts || !pts.length) return;
                const idx = pts[0].index;
                const roomName = pieChart.data.labels[idx];
                openDivisionModal(roomName, pieChart._roomMapping && pieChart._roomMapping[roomName] ? pieChart._roomMapping[roomName].items : []);
            });

            pieChart._listenersBound = true;
        } else {
            // atualizar também mapeamento quando o chart já existe
            pieChart._roomMapping = mapping || {};
        }
        // render dynamic legend based on current equipments
        try{
            const legendLabels = labels.length ? labels : pieLabels;
            const legendValues = labels.length ? values : pieData.datasets[0].data;
            renderLegend(legendLabels, legendValues, pieChart._baseColors || colors);
        }catch(e){ console.warn('renderLegend failed', e); }

        // funções para abrir/fechar o modal de divisão
        function openDivisionModal(roomName, items){
            const modal = document.getElementById('divisionModal');
            const title = document.getElementById('divisionModalTitle');
            const body = document.getElementById('divisionModalBody');
            if(!modal || !body) return;
            title.textContent = `Equipamentos — ${roomName}`;
            // construir lista de equipamentos com estilo de cartão
            if(!items || !items.length){
                body.innerHTML = `<div class="division-list-empty">Não existem equipamentos registados nesta divisão.</div>`;
            } else {
                // calcular total da divisão e obter custo da fatura mais recente
                const divisionTotal = items.reduce((s,it)=> s + (Number(it.monthlyKwh) || 0), 0) || 0;
                const allInvoices = loadAllInvoices();
                const latestYM = getLatestYearMonth(allInvoices);
                let latestAgg = null;
                if(latestYM) latestAgg = aggregateForYearMonth(latestYM.year, latestYM.month, allInvoices);
                const invoiceCostTotal = (latestAgg && Number(latestAgg.cost)) ? Number(latestAgg.cost) : 0;
                const invoiceConsumptionTotal = (latestAgg && Number(latestAgg.consumption)) ? Number(latestAgg.consumption) : 0;

                // use global icon map (defined in renderLegend) — recreate similar map here
                const roomIcons = {
                    'Lavandaria': '🧺',
                    'Cozinha': '🍳',
                    'Sala': '🛋️',
                    'Quarto': '🛏️',
                    'Casa de Banho': '🚿',
                    'Garagem': '🔌',
                    'Exterior': '🌿',
                    'Escritório': '💼',
                    'Outros': '📦',
                    'Sem divisão': '🏠'
                };

                const cards = items.map(it=>{
                    const name = escapeHtml(it.name || 'Sem nome');
                    const kwhVal = (typeof it.monthlyKwh === 'number') ? it.monthlyKwh : Number(it.monthlyKwh) || 0;
                    const kwhStr = Number(kwhVal).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1});
                    // percent within division (for display)
                    const percent = divisionTotal > 0 ? (kwhVal / divisionTotal) * 100 : 0;
                    const pctStr = `${percent.toFixed(1)}%`;
                    // compute cost share based on proportion of the whole invoice consumption (more realistic)
                    const costShare = (invoiceConsumptionTotal > 0 && invoiceCostTotal > 0) ? (invoiceCostTotal * (kwhVal / invoiceConsumptionTotal)) : 0;
                    const costStr = (invoiceConsumptionTotal > 0 && invoiceCostTotal > 0) ? `€${costShare.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})} da fatura` : `€0.00 da fatura`;
                    // potência e horas: tentar extrair números
                    const powerNum = (function(p){ const n = parseFloat(String(p||'').replace(/[^0-9\.\-]/g,'')); return isNaN(n) ? (p||'') : `${Math.round(n)}W`; })(it.power);
                    const hoursNum = (function(h){ const n = parseFloat(String(h||'').replace(/[^0-9\.\-]/g,'')); return isNaN(n) ? (h||'') : `${n}h/dia`; })(it.hours);
                    const roomName = (it.room && String(it.room).trim()) ? String(it.room).trim() : 'Sem divisão';
                    const icon = roomIcons[roomName] || '⚡';

                    return `
                        <div class="division-entry">
                            <div class="division-icon">${icon}</div>
                            <div class="division-content">
                                <div class="division-name">${name}</div>
                                <div class="division-sub">${pctStr} do consumo desta divisão</div>
                                <div class="division-cost">${costStr}</div>
                            </div>
                            <div class="division-right">
                                <div class="division-kwh-badge">${kwhStr} kWh</div>
                                <div class="division-specs">${powerNum} • ${hoursNum}</div>
                            </div>
                        </div>
                    `;
                }).join('\n');

                body.innerHTML = cards + `\n<div class="division-tip">💡 Dica: Os equipamentos listados mostram o custo calculado com base na última fatura inserida. Considere otimizar o uso dos equipamentos com maior custo para reduzir a sua fatura.</div>`;
            }
            // abrir modal
            modal.setAttribute('aria-hidden','false');
            // focus no botão fechar
            const first = modal.querySelector('button, a, input'); if(first) first.focus();

            // bind close buttons (exists in modal markup)
            const closeBtn = modal.querySelector('.modal-close');
            const cancelBtn = modal.querySelector('.modal-cancel');
            function closeHandler(e){ e && e.preventDefault && e.preventDefault(); modal.setAttribute('aria-hidden','true'); }
            if(closeBtn) closeBtn.addEventListener('click', closeHandler, { once: true });
            if(cancelBtn) cancelBtn.addEventListener('click', closeHandler, { once: true });
            // click fora fecha
            modal.addEventListener('click', function onOutsideClick(ev){ if(ev.target === modal){ modal.setAttribute('aria-hidden','true'); modal.removeEventListener('click', onOutsideClick); } });
            // ESC fecha
            function escListener(ev){ if(ev.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false'){ modal.setAttribute('aria-hidden','true'); document.removeEventListener('keydown', escListener); } }
            document.addEventListener('keydown', escListener);
        }

        // ligar cliques da legenda ao modal de divisão
        try{
            const legendListEl = document.querySelector('.legend-list');
            if(legendListEl){
                const lis = Array.from(legendListEl.querySelectorAll('li'));
                lis.forEach((li, idx) => {
                    li.style.cursor = 'pointer';
                    li.addEventListener('click', ()=>{
                        try{
                            const roomName = (labels && labels[idx]) ? labels[idx] : (pieChart && pieChart.data && pieChart.data.labels && pieChart.data.labels[idx]) || '';
                            const items = (pieChart && pieChart._roomMapping && pieChart._roomMapping[roomName]) ? pieChart._roomMapping[roomName].items : [];
                            openDivisionModal(roomName, items);
                        }catch(err){ console.warn('legend click handler failed', err); }
                    });
                });
            }
        }catch(e){ console.warn('bind legend click failed', e); }

        // ---- LINE CHART: Progressão do Consumo por mês ----
        const lineCtx = document.getElementById('barChart').getContext('2d');
        const INVOICE_KEY_MAIN = 'ecohome_invoices_v1';
        let invoices = [];
        try{ const raw = localStorage.getItem(INVOICE_KEY_MAIN); invoices = raw ? JSON.parse(raw) : []; }catch(e){ invoices = []; }

        // allow year filter
        populateYearFilter(invoices);
        const yearSel = document.getElementById('yearFilterSelect');
        const selectedYear = yearSel ? (yearSel.value || '') : '';
        if(selectedYear){
            invoices = (Array.isArray(invoices) ? invoices.filter(inv=>{
                const m = String(inv.month || '').trim();
                if(!m) return false;
                if(m.indexOf('-') !== -1){
                    const parts = m.split('-');
                    return String(parts[0]) === String(selectedYear);
                } else {
                    const yr = String(Number(m) || '');
                    return yr === String(selectedYear);
                }
            }) : []);
        }

        // Always show 12 months on the X axis (1..12). Fill values up to the last month that has a fatura.
        const monthsAll = Array.from({length:12}, (_,i)=> i+1);
        let lineLabels = monthsAll.map(n=>String(n));
        let lineValues = Array(12).fill(null);
        let lineCosts = Array(12).fill(null);
        if(Array.isArray(invoices) && invoices.length){
            const aggCons = {};
            const aggCost = {};
            invoices.forEach(inv=>{
                const m = String(inv.month || '').trim();
                let monthNum = 0;
                if(m.indexOf('-') !== -1){
                    const parts = m.split('-');
                    monthNum = Number(parts[1]) || 0;
                } else {
                    monthNum = Number(m) || 0;
                }
                if(!monthNum || monthNum < 1 || monthNum > 12) return;
                aggCons[monthNum] = (aggCons[monthNum] || 0) + (Number(inv.consumption) || 0);
                aggCost[monthNum] = (aggCost[monthNum] || 0) + (Number(inv.cost) || 0);
            });
            const monthsPresent = Object.keys(aggCons).map(n=>Number(n)).filter(n=>n>=1 && n<=12);
            const maxMonth = monthsPresent.length ? Math.max(...monthsPresent) : 0;
            for(let m=1;m<=12;m++){
                if(m <= maxMonth){
                    lineValues[m-1] = Number(((aggCons[m] || 0)).toFixed(2));
                    lineCosts[m-1] = Number(((aggCost[m] || 0)).toFixed(2));
                } else {
                    lineValues[m-1] = null;
                    lineCosts[m-1] = null;
                }
            }
        } else {
            // no invoices: keep months but no data (all null)
            lineValues = Array(12).fill(null);
            lineCosts = Array(12).fill(null);
        }

        const lineDataLocal = {
            labels: lineLabels,
            datasets: [{ label: 'Consumo (kWh)', data: lineValues, borderColor: originalColors[1] || '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)', tension:0.3, fill:true, pointRadius:4 }]
        };

        // external tooltip function to show consumption and cost with percent change vs previous month
        function externalLineTooltip(context){
            // Tooltip Element
            const {chart, tooltip} = context;
            let tooltipEl = document.getElementById('chartjs-external-tooltip');
            if(!tooltipEl){
                tooltipEl = document.createElement('div');
                tooltipEl.id = 'chartjs-external-tooltip';
                tooltipEl.className = 'chartjs-external-tooltip';
                document.body.appendChild(tooltipEl);
            }

            // Hide if no tooltip
            if(tooltip.opacity === 0){ tooltipEl.style.opacity = 0; return; }

            // Set caret position
            const canvasRect = chart.canvas.getBoundingClientRect();

            // Build tooltip content
            const titleLines = tooltip.title || [];
            const bodyLines = tooltip.dataPoints || [];

            // compute month index from first dataPoint
            const dp = bodyLines[0];
            const idx = dp ? dp.dataIndex : null; // 0-based
            const monthNum = (typeof idx === 'number') ? (idx + 1) : null;

            // get datasets and costs stored on chart
            const dataArr = chart.data.datasets && chart.data.datasets[0] ? chart.data.datasets[0].data : [];
            const costsArr = chart._lineCosts || [];

            function fmtNum(n, opts){ return Number(n || 0).toLocaleString('pt-BR', opts || {minimumFractionDigits:2,maximumFractionDigits:2}); }

            const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
            let html = '';
            // title: show month name (only text)
            const titleText = monthNum && monthNum >=1 && monthNum <=12 ? monthNames[monthNum-1] : (titleLines.length ? escapeHtml(titleLines[0]) : '');
            html += `<div class="title">${titleText}</div>`;

            // consumption line
            if(monthNum !== null){
                const curCons = (typeof dataArr[idx] === 'number') ? Number(dataArr[idx]) : (dataArr[idx] == null ? null : Number(dataArr[idx]));
                const prevCons = (idx > 0 && typeof dataArr[idx-1] === 'number') ? Number(dataArr[idx-1]) : (idx>0 && dataArr[idx-1]!=null ? Number(dataArr[idx-1]) : null);
                let pctCons = null; let pctClass = '';
                if(prevCons === null || prevCons === 0 || prevCons === undefined) pctCons = null; else { pctCons = ((curCons - prevCons)/prevCons)*100; pctClass = (pctCons > 0) ? 'increase' : (pctCons < 0 ? 'decrease' : ''); }
                const sign = (pctCons === null || isNaN(pctCons)) ? '' : (pctCons > 0 ? '+' : (pctCons < 0 ? '-' : ''));
                const pctText = (pctCons === null || isNaN(pctCons)) ? '(N/A)' : `(${sign}${Math.abs(pctCons).toFixed(2)}%)`;
                const pctSpan = (pctCons === null || isNaN(pctCons)) ? `<span class="pct">${pctText}</span>` : `<span class="pct ${pctClass}">${pctText}</span>`;
                html += `<div class="line">Consumo: ${curCons === null ? '—' : fmtNum(curCons) + ' kWh'} ${pctSpan}</div>`;
            }

            // cost line
            if(monthNum !== null){
                const curCost = (Array.isArray(costsArr) && typeof costsArr[idx] === 'number') ? Number(costsArr[idx]) : (costsArr[idx] == null ? null : Number(costsArr[idx]));
                const prevCost = (idx > 0 && Array.isArray(costsArr) && typeof costsArr[idx-1] === 'number') ? Number(costsArr[idx-1]) : (idx>0 && costsArr[idx-1]!=null ? Number(costsArr[idx-1]) : null);
                let pctCost = null; let pctClassC = '';
                if(prevCost === null || prevCost === 0 || prevCost === undefined) pctCost = null; else { pctCost = ((curCost - prevCost)/prevCost)*100; pctClassC = (pctCost > 0) ? 'increase' : (pctCost < 0 ? 'decrease' : ''); }
                const signC = (pctCost === null || isNaN(pctCost)) ? '' : (pctCost > 0 ? '+' : (pctCost < 0 ? '-' : ''));
                const pctTextC = (pctCost === null || isNaN(pctCost)) ? '(N/A)' : `(${signC}${Math.abs(pctCost).toFixed(2)}%)`;
                const pctSpanC = (pctCost === null || isNaN(pctCost)) ? `<span class="pct">${pctTextC}</span>` : `<span class="pct ${pctClassC}">${pctTextC}</span>`;
                html += `<div class="line">Custo: €${curCost === null ? '—' : fmtNum(curCost)} ${pctSpanC}</div>`;
            }

            tooltipEl.innerHTML = html;
            tooltipEl.style.opacity = 1;

            // position tooltip near caret
            const pos = chart.canvas.getBoundingClientRect();
            const left = pos.left + (tooltip.caretX || 0);
            const top = pos.top + (tooltip.caretY || 0);
            tooltipEl.style.left = left + 'px';
            tooltipEl.style.top = (top - 10) + 'px';
        }

        if(!barChart){
            barChart = new Chart(lineCtx, {
                type: 'line',
                data: lineDataLocal,
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            enabled: false,
                            external: externalLineTooltip
                        }
                    },
                    scales: {
                        y: { beginAtZero: true, grid: { color: '#eef2f7' } },
                        x: { title: { display: true, text: 'Mês' } }
                    }
                }
            });
        } else {
            barChart.data = lineDataLocal; 
            // update stored costs for tooltip
            barChart._lineCosts = lineCosts.slice();
            barChart.update();
        }
        // always sync costs
        if(barChart) barChart._lineCosts = lineCosts.slice();
    }

    // helper: return sorted years (desc) from invoices
    function getInvoiceYears(invoices){
        const set = new Set();
        if(Array.isArray(invoices)){
            invoices.forEach(inv=>{
                const m = String(inv.month || '').trim();
                if(!m) return;
                if(m.indexOf('-') !== -1){ const parts = m.split('-'); if(parts[0]) set.add(String(parts[0])); }
                else { const maybe = String(Number(m) || ''); if(maybe) set.add(maybe); }
            });
        }
        const years = Array.from(set).map(y=>Number(y)).filter(n=>!isNaN(n)).sort((a,b)=>b-a).map(n=>String(n));
        return years;
    }

    // load all invoices helper (safe)
    function loadAllInvoices(){
        try{ const raw = localStorage.getItem('ecohome_invoices_v1'); const arr = raw ? JSON.parse(raw) : []; return Array.isArray(arr) ? arr : []; }catch(e){ return []; }
    }

    // parse invoice to determine a year-month (preferred) or fallback to created timestamp
    function parseInvoiceYearMonth(inv){
        if(!inv) return null;
        const m = String(inv.month || '').trim();
        if(m && m.indexOf('-') !== -1){
            const parts = m.split('-');
            const y = Number(parts[0]) || NaN;
            const mm = Number(parts[1]) || NaN;
            if(!isNaN(y) && !isNaN(mm) && mm >=1 && mm <=12) return { year: y, month: mm };
        }
        // fallback: try to use created timestamp if present
        if(inv.created){
            const d = new Date(Number(inv.created));
            if(!isNaN(d.getTime())) return { year: d.getFullYear(), month: d.getMonth() + 1 };
        }
        return null;
    }

    // return latest year-month as {year, month, key:'YYYY-MM'} or null
    function getLatestYearMonth(invoices){
        if(!Array.isArray(invoices) || invoices.length === 0) return null;
        let best = null; let bestScore = -Infinity;
        invoices.forEach(inv=>{
            const pm = parseInvoiceYearMonth(inv);
            if(!pm) return;
            const score = (pm.year * 100) + (pm.month || 0);
            if(score > bestScore){ bestScore = score; best = pm; }
        });
        if(!best) return null;
        const key = `${String(best.year).padStart(4,'0')}-${String(best.month).padStart(2,'0')}`;
        return { year: best.year, month: best.month, key };
    }

    // aggregate consumption and cost for a given year and month
    function aggregateForYearMonth(year, month, invoices){
        const arr = Array.isArray(invoices) ? invoices : loadAllInvoices();
        let sumCons = 0; let sumCost = 0; let found = false;
        arr.forEach(inv=>{
            const pm = parseInvoiceYearMonth(inv);
            if(!pm) return;
            if(pm.year === Number(year) && pm.month === Number(month)){
                sumCons += Number(inv.consumption) || 0;
                sumCost += Number(inv.cost) || 0;
                found = true;
            }
        });
        return found ? { consumption: Number(sumCons.toFixed(2)), cost: Number(sumCost.toFixed(2)) } : null;
    }

    // update top invoice-related metric cards to reflect the most recent date available
    function updateTopInvoiceMetrics(invoices){
        try{
            const arr = Array.isArray(invoices) ? invoices : loadAllInvoices();
            const metricEls = document.querySelectorAll('.metric .value');
            if(!metricEls || metricEls.length < 2){ return; }
            if(!arr || arr.length === 0){ metricEls[0].textContent = '-'; metricEls[1].textContent = '-'; return; }
            const latest = getLatestYearMonth(arr);
            if(!latest){ metricEls[0].textContent = '-'; metricEls[1].textContent = '-'; return; }
            const agg = aggregateForYearMonth(latest.year, latest.month, arr);
            if(!agg){ metricEls[0].textContent = '-'; metricEls[1].textContent = '-'; return; }
            metricEls[0].textContent = `${agg.consumption.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})} kWh`;
            metricEls[1].textContent = `€${agg.cost.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
        }catch(e){ console.warn('updateTopInvoiceMetrics error', e); }
    }

    // update the 'Poupança' metric: percent saved comparing previous available month to current latest month
    function updateSavingsMetric(invoices){
        try{
            const arr = Array.isArray(invoices) ? invoices : loadAllInvoices();
            if(!arr || arr.length === 0){
                // no data
                const allMetricValues = document.querySelectorAll('.metric .value');
                if(allMetricValues && allMetricValues.length >= 3) allMetricValues[2].textContent = '-';
                return;
            }
            // aggregate by YYYY-MM key using cost (we compute savings based on cost)
            const aggCost = {};
            arr.forEach(inv=>{
                const pm = parseInvoiceYearMonth(inv);
                if(!pm) return;
                const key = `${String(pm.year).padStart(4,'0')}-${String(pm.month).padStart(2,'0')}`;
                aggCost[key] = (aggCost[key] || 0) + (Number(inv.cost) || 0);
            });
            const keys = Object.keys(aggCost).sort();
            if(keys.length === 0){ const allMetricValues = document.querySelectorAll('.metric .value'); if(allMetricValues && allMetricValues.length >= 3) allMetricValues[2].textContent = '-'; return; }
            const latestKey = keys[keys.length - 1];
            const prevKey = keys.length >= 2 ? keys[keys.length - 2] : null;
            const latestCost = Number(aggCost[latestKey] || 0);
            const prevCost = prevKey ? Number(aggCost[prevKey] || 0) : null;
            let pctSaved = null;
            if(prevCost === null || prevCost === 0){ pctSaved = null; } else { pctSaved = ((prevCost - latestCost) / prevCost) * 100; }
            const allMetricValues = document.querySelectorAll('.metric .value');
            if(allMetricValues && allMetricValues.length >= 3){
                const el = allMetricValues[2];
                if(pctSaved === null || isNaN(pctSaved)){
                    el.textContent = '-';
                    el.style.color = '';
                } else {
                    const rounded = pctSaved.toFixed(2);
                    if(pctSaved > 0){ el.textContent = `+${rounded}%`; el.style.color = '#16a34a'; }
                    else if(pctSaved < 0){ el.textContent = `${rounded}%`; el.style.color = '#dc2626'; }
                    else { el.textContent = `0.00%`; el.style.color = ''; }
                }
            }
        }catch(e){ console.warn('updateSavingsMetric error', e); }
    }

    // initial render
    createOrUpdateCharts();
    // ensure metrics reflect stored invoices on load
    try{ updateTopInvoiceMetrics(); }catch(e){}
    try{ updateSavingsMetric(); }catch(e){}

    // update charts and metrics when storage changes (e.g., profile page updates equipments or invoices)
    window.addEventListener('storage', (e)=>{ if(e.key === STORAGE_KEY_MAIN || e.key === 'ecohome_invoices_v1'){ createOrUpdateCharts(); try{ updateTopInvoiceMetrics(); }catch(err){} try{ updateSavingsMetric(); }catch(err){} } });

    // --- Modal: Nova Fatura (index) ---
    const invoiceModal = document.getElementById('newInvoiceModal');
    const openInvoiceBtn = document.getElementById('openInvoiceBtn');
    let editingInvoiceIdx = null; // when editing an existing invoice, store its index in storage
    let pendingEditData = null; // { month, consumption, cost } (moved to outer scope so confirm modal can access)
    let invoicesSort = { field: null, dir: null }; // e.g. {field:'month', dir:'desc'}
    if(openInvoiceBtn && invoiceModal){
        const closeBtn = invoiceModal.querySelector('.modal-close');
        const cancelBtn = invoiceModal.querySelector('.modal-cancel');
        const form = document.getElementById('newInvoiceForm');

        function openInvoiceModal(){
            // ensure this modal appears above any other (e.g. viewInvoicesModal)
            try{ invoiceModal.style.zIndex = '1400'; }catch(e){}
            invoiceModal.setAttribute('aria-hidden','false');
            const first = invoiceModal.querySelector('input, button, select');
            if(first) first.focus();
        }
        function closeInvoiceModal(){
            invoiceModal.setAttribute('aria-hidden','true');
            try{ invoiceModal.style.zIndex = ''; }catch(e){}
            openInvoiceBtn.focus();
        }

        openInvoiceBtn.addEventListener('click', (e)=>{ e.preventDefault(); openInvoiceModal(); });
        closeBtn && closeBtn.addEventListener('click', (e)=>{ e.preventDefault(); closeInvoiceModal(); });
        cancelBtn && cancelBtn.addEventListener('click', (e)=>{ e.preventDefault(); closeInvoiceModal(); });
        invoiceModal.addEventListener('click', (e)=>{ if(e.target === invoiceModal) closeInvoiceModal(); });
        document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape' && invoiceModal.getAttribute('aria-hidden') === 'false') closeInvoiceModal(); });

        // persist invoices list in localStorage and update metric cards
        const INVOICE_KEY = 'ecohome_invoices_v1';
        function loadInvoices(){
            try{ const raw = localStorage.getItem(INVOICE_KEY); const arr = raw ? JSON.parse(raw) : []; return Array.isArray(arr) ? arr : []; }catch(e){ return []; }
        }
        function saveInvoiceObj(obj){
            const arr = loadInvoices();
            arr.push(obj);
            try{ localStorage.setItem(INVOICE_KEY, JSON.stringify(arr)); }catch(e){ console.warn('invoice save failed', e); }
        }

        // metric elements to update
        const totalConsumptionEl = document.querySelector('.metric .value') || document.getElementById('totalConsumptionValue');
        const allMetricValues = document.querySelectorAll('.metric .value');

        // helper to actually persist the invoice (used by direct save and by confirmation)
        function persistInvoiceObject(obj, isUpdateIndex){
            if(typeof isUpdateIndex === 'number' && !isNaN(isUpdateIndex)){
                const arr = loadInvoices();
                arr[isUpdateIndex] = obj;
                try{ localStorage.setItem(INVOICE_KEY, JSON.stringify(arr)); }catch(e){ console.warn('invoice update failed', e); }
            } else {
                saveInvoiceObj(obj);
            }
            try{ updateTopInvoiceMetrics(); }catch(e){ console.warn('updateTopInvoiceMetrics failed', e); }
            try{ createOrUpdateCharts(); }catch(err){ console.warn('chart refresh failed', err); }
            try{ updateSavingsMetric(); }catch(err){ console.warn('updateSavingsMetric failed', err); }
            // if the invoices list modal is open, refresh its contents
            try{ if(typeof window.renderInvoicesList === 'function') window.renderInvoicesList(); }catch(e){}
        }

        // We'll show a confirmation modal when the form is submitted while editing
        form && form.addEventListener('submit', (e)=>{
            e.preventDefault();
            const fd = new FormData(form);
            const month = fd.get('month') || '';
            const consumption = parseFloat(fd.get('consumption')) || 0;
            const cost = parseFloat(fd.get('cost')) || 0;

            // if we're editing an existing invoice, show confirm modal instead of saving immediately
            const arr = loadInvoices();
            if(editingInvoiceIdx !== null && !isNaN(editingInvoiceIdx) && editingInvoiceIdx >= 0 && editingInvoiceIdx < arr.length){
                // store pending values and open confirmation
                pendingEditData = { month, consumption, cost };
                // open confirm modal (defined later)
                if(window.openConfirmEditModal) window.openConfirmEditModal();
                return;
            }

            // otherwise, new invoice -> save immediately
            const inv = { month, consumption, cost, created: Date.now() };
            // persist and refresh UI (persistInvoiceObject will call save when needed)
            persistInvoiceObject(inv);
            closeInvoiceModal();
        });
    }

    // --- Modal: Ver Faturas (lista) ---
    const viewInvoicesModal = document.getElementById('viewInvoicesModal');
    const viewInvoicesBtn = document.getElementById('viewInvoicesBtn');
    const invoicesTableBody = document.getElementById('invoicesTableBody');
    if(viewInvoicesBtn && viewInvoicesModal){
        const closeBtnV = viewInvoicesModal.querySelector('.modal-close');
        const cancelBtnV = viewInvoicesModal.querySelector('.modal-cancel');

        function openViewInvoicesModal(){
            viewInvoicesModal.setAttribute('aria-hidden','false');
            renderInvoicesList();
            const first = viewInvoicesModal.querySelector('button, a, input'); if(first) first.focus();
        }
        function closeViewInvoicesModal(){
            viewInvoicesModal.setAttribute('aria-hidden','true');
            viewInvoicesBtn.focus();
        }

        function sortMappedInvoices(mapped){
            if(!invoicesSort || !invoicesSort.field) return mapped;
            const dir = invoicesSort.dir === 'asc' ? 1 : -1;
            return mapped.sort((a,b)=>{
                const A = a.inv, B = b.inv;
                if(invoicesSort.field === 'index'){
                    return dir * (a.__idx - b.__idx);
                }
                if(invoicesSort.field === 'month'){
                    const pa = parseInvoiceYearMonth(A); const pb = parseInvoiceYearMonth(B);
                    const sa = pa ? (pa.year*100 + pa.month) : (A.created || 0);
                    const sb = pb ? (pb.year*100 + pb.month) : (B.created || 0);
                    return dir * (sa - sb);
                }
                if(invoicesSort.field === 'consumption'){
                    return dir * ((Number(A.consumption)||0) - (Number(B.consumption)||0));
                }
                if(invoicesSort.field === 'cost'){
                    return dir * ((Number(A.cost)||0) - (Number(B.cost)||0));
                }
                return 0;
            });
        }

        function renderInvoicesList(){
            try{
                const arr = loadAllInvoices();
                const tbody = invoicesTableBody;
                const emptyEl = viewInvoicesModal.querySelector('.empty-state');
                if(!tbody) return;
                tbody.innerHTML = '';
                if(!arr || arr.length === 0){ if(emptyEl) emptyEl.style.display = 'block'; return; }
                if(emptyEl) emptyEl.style.display = 'none';

                // map with original index so actions refer to original storage index
                const mapped = arr.map((inv,i)=>({ inv, __idx: i }));
                const sorted = sortMappedInvoices(mapped.slice());

                sorted.forEach((entry, displayIdx)=>{
                    const inv = entry.inv;
                    const origIdx = entry.__idx;
                    const pm = parseInvoiceYearMonth(inv);
                    const monthText = pm ? `${String(pm.year)}-${String(pm.month).padStart(2,'0')}` : (inv.month || '-');
                    const cons = Number(inv.consumption || 0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
                    const cost = Number(inv.cost || 0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td style="text-align:left">${displayIdx+1}</td>
                        <td style="text-align:left">${monthText}</td>
                        <td style="text-align:center">${cons}</td>
                        <td style="text-align:center">€${cost}</td>
                        <td style="text-align:center">
                            <button class="invoice-edit" data-index="${origIdx}" title="Editar">✎</button>
                            <button class="invoice-delete" data-index="${origIdx}" title="Eliminar">🗑️</button>
                        </td>
                    `;
                    tbody.appendChild(tr);
                });
                // expose render helper globally so other parts (e.g., confirm modal) can refresh the list
                try{ window.renderInvoicesList = renderInvoicesList; }catch(e){}
            }catch(e){ console.warn('renderInvoicesList error', e); }
        }

        // delegate clicks for delete and edit
        invoicesTableBody && invoicesTableBody.addEventListener('click', (e)=>{
            const del = e.target.closest('.invoice-delete');
            if(del){
                const idx = Number(del.getAttribute('data-index'));
                if(isNaN(idx)) return;
                try{
                    const arr = loadAllInvoices();
                    if(idx < 0 || idx >= arr.length) return;
                    arr.splice(idx,1);
                    localStorage.setItem('ecohome_invoices_v1', JSON.stringify(arr));
                    renderInvoicesList();
                    try{ createOrUpdateCharts(); }catch(err){}
                    try{ updateTopInvoiceMetrics(); }catch(err){}
                    try{ updateSavingsMetric(); }catch(err){}
                }catch(err){ console.warn('invoice delete failed', err); }
                return;
            }
            const ed = e.target.closest('.invoice-edit');
            if(ed){
                const idx = Number(ed.getAttribute('data-index'));
                if(isNaN(idx)) return;
                try{
                    const arr = loadAllInvoices();
                    if(idx < 0 || idx >= arr.length) return;
                    const inv = arr[idx];
                    // prefill form
                    const form = document.getElementById('newInvoiceForm');
                    if(form){
                        form.elements['month'].value = inv.month || '';
                        form.elements['consumption'].value = (typeof inv.consumption !== 'undefined') ? String(inv.consumption) : '';
                        form.elements['cost'].value = (typeof inv.cost !== 'undefined') ? String(inv.cost) : '';
                    }
                    // set editing index and open modal
                    editingInvoiceIdx = idx;
                    const title = invoiceModal.querySelector('#invoiceTitle'); if(title) title.textContent = 'Editar Fatura';
                    openInvoiceModal();
                }catch(err){ console.warn('invoice edit failed', err); }
                return;
            }
        });

        viewInvoicesBtn.addEventListener('click', (e)=>{ e.preventDefault(); openViewInvoicesModal(); });
        closeBtnV && closeBtnV.addEventListener('click', (e)=>{ e.preventDefault(); closeViewInvoicesModal(); });
        cancelBtnV && cancelBtnV.addEventListener('click', (e)=>{ e.preventDefault(); closeViewInvoicesModal(); });
        viewInvoicesModal.addEventListener('click', (e)=>{ if(e.target === viewInvoicesModal) closeViewInvoicesModal(); });
        document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape' && viewInvoicesModal.getAttribute('aria-hidden') === 'false') closeViewInvoicesModal(); });
    }

    // --- Modal: Confirmar Edição ---
    const confirmEditModal = document.getElementById('confirmEditModal');
    const confirmEditBtn = document.getElementById('confirmEditBtn');
    if(confirmEditModal){
        const closeBtnC = confirmEditModal.querySelector('.modal-close');
        const cancelBtnC = confirmEditModal.querySelector('.modal-cancel');
        function openConfirmEditModal(){
            try{ confirmEditModal.style.zIndex = '1500'; }catch(e){}
            confirmEditModal.setAttribute('aria-hidden','false');
            const first = confirmEditModal.querySelector('button, a, input'); if(first) first.focus();
        }
        function closeConfirmEditModal(){
            confirmEditModal.setAttribute('aria-hidden','true');
            try{ confirmEditModal.style.zIndex = ''; }catch(e){}
        }
        // expose open helper for earlier code
        window.openConfirmEditModal = openConfirmEditModal;
        closeBtnC && closeBtnC.addEventListener('click', (e)=>{ e.preventDefault(); closeConfirmEditModal(); });
        cancelBtnC && cancelBtnC.addEventListener('click', (e)=>{ e.preventDefault(); closeConfirmEditModal(); });
        confirmEditModal.addEventListener('click', (e)=>{ if(e.target === confirmEditModal) closeConfirmEditModal(); });
        document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape' && confirmEditModal.getAttribute('aria-hidden') === 'false') closeConfirmEditModal(); });
        // when confirm pressed, perform the pending update
        if(confirmEditBtn){
            confirmEditBtn.addEventListener('click', (e)=>{
                e.preventDefault();
                    try{
                        if(typeof pendingEditData === 'object' && pendingEditData !== null && editingInvoiceIdx !== null && !isNaN(editingInvoiceIdx)){
                            const base = loadAllInvoices();
                            if(editingInvoiceIdx >=0 && editingInvoiceIdx < base.length){
                                const existing = base[editingInvoiceIdx] || {};
                                const inv = { month: pendingEditData.month, consumption: pendingEditData.consumption, cost: pendingEditData.cost, created: existing.created || Date.now() };
                                // persist
                                try{ base[editingInvoiceIdx] = inv; localStorage.setItem('ecohome_invoices_v1', JSON.stringify(base)); }catch(err){ console.warn('invoice update failed', err); }
                                // UI updates
                                try{ updateTopInvoiceMetrics(); }catch(e){}
                                try{ createOrUpdateCharts(); }catch(e){}
                                try{ updateSavingsMetric(); }catch(e){}
                                try{ if(typeof window.renderInvoicesList === 'function') window.renderInvoicesList(); }catch(e){}
                            }
                        }
                    }catch(err){ console.warn('confirm edit failed', err); }
                // cleanup
                pendingEditData = null;
                editingInvoiceIdx = null;
                const title = invoiceModal ? invoiceModal.querySelector('#invoiceTitle') : null; if(title) title.textContent = 'Nova Fatura';
                closeConfirmEditModal();
                closeInvoiceModal();
            });
        }
    }

    // sortable headers in invoices table
    (function(){
        const table = document.querySelector('.invoice-table');
        if(!table) return;
        const headers = table.querySelectorAll('thead th.sortable');
        headers.forEach(h=>{
            h.addEventListener('click', ()=>{
                const field = h.getAttribute('data-sort');
                if(!field) return;
                // toggle sort behavior
                // default toggling: null -> desc -> asc -> null
                // but for 'index' (Ordem) we want null -> asc -> desc -> null (menor->maior then reverse)
                if(!invoicesSort.field || invoicesSort.field !== field){
                    invoicesSort.field = field;
                    invoicesSort.dir = (field === 'index') ? 'asc' : 'desc';
                }
                else if(invoicesSort.field === field && invoicesSort.dir === 'desc'){
                    invoicesSort.dir = 'asc';
                }
                else if(invoicesSort.field === field && invoicesSort.dir === 'asc'){
                    // if already asc, toggle to none
                    invoicesSort.field = null; invoicesSort.dir = null;
                }
                else {
                    // fallback
                    invoicesSort.field = null; invoicesSort.dir = null;
                }
                // update header classes
                headers.forEach(x=> x.classList.remove('asc','desc'));
                if(invoicesSort.field){ const hh = table.querySelector(`thead th[data-sort="${invoicesSort.field}"]`); if(hh) hh.classList.add(invoicesSort.dir); }
                // re-render list if modal open
                if(viewInvoicesModal && viewInvoicesModal.getAttribute('aria-hidden') === 'false') renderInvoicesList();
            });
        });
    })();

    // --- Modal: Comparar Anos ---
    const compareModal = document.getElementById('compareModal');
    const openCompareBtn = document.getElementById('openCompareBtn');
    if(openCompareBtn && compareModal){
        const closeBtnC = compareModal.querySelector('.modal-close');
        const cancelBtnC = compareModal.querySelector('.modal-cancel');
        const formC = document.getElementById('compareForm');
        const selectsContainer = document.getElementById('compareSelects');
        const addBtn = document.getElementById('addCompareYear');
        const removeBtn = document.getElementById('removeCompareYear');
        const compareCtx = document.getElementById('compareChart').getContext('2d');

        function clearCompareChart(){ try{ if(compareChart){ compareChart.destroy(); compareChart = null; } }catch(e){}
        }

        function buildSelectOptions(select, years){
            select.innerHTML = '';
            years.forEach(y=>{ const o = document.createElement('option'); o.value = y; o.textContent = y; select.appendChild(o); });
        }

        function getCurrentSelects(){
            return Array.from(selectsContainer.querySelectorAll('.compare-year'));
        }

        function openCompareModal(){
            compareModal.setAttribute('aria-hidden','false');
            // populate available years
            const raw = localStorage.getItem('ecohome_invoices_v1');
            let invoices = raw ? JSON.parse(raw) : [];
            const years = getInvoiceYears(invoices);
            if(years.length === 0){ const cy = String(new Date().getFullYear()); years.push(cy); years.push(String(Number(cy)-1)); }
            if(years.length === 1) years.push(String(Number(years[0]) - 1));

            // ensure we have at least two selects initially
            const existing = getCurrentSelects();
            if(existing.length < 2){
                selectsContainer.innerHTML = '';
                for(let i=0;i<2;i++){
                    const lbl = document.createElement('label'); lbl.textContent = 'Ano\n';
                    const sel = document.createElement('select'); sel.className = 'compare-year'; sel.name = 'year[]';
                    buildSelectOptions(sel, years);
                    lbl.appendChild(sel);
                    selectsContainer.appendChild(lbl);
                }
            } else {
                // refresh options for existing selects
                existing.forEach(s=> buildSelectOptions(s, years));
            }

            // default values: most recent, previous, etc.
            const allSel = getCurrentSelects();
            allSel.forEach((s, idx)=>{ s.value = years[idx] || years[0]; });

            // show/hide remove button
            removeBtn.style.display = allSel.length > 2 ? 'inline-flex' : 'none';

            const first = compareModal.querySelector('select, button'); if(first) first.focus();
            clearCompareChart();
        }

        function closeCompareModal(){
            compareModal.setAttribute('aria-hidden','true');
            openCompareBtn.focus();
            clearCompareChart();
        }

        function addCompareYear(){
            const raw = localStorage.getItem('ecohome_invoices_v1');
            let invoices = raw ? JSON.parse(raw) : [];
            const years = getInvoiceYears(invoices);
            if(years.length === 0){ const cy = String(new Date().getFullYear()); years.push(cy); years.push(String(Number(cy)-1)); }
            // create new select
            const lbl = document.createElement('label'); lbl.textContent = 'Ano\n';
            const sel = document.createElement('select'); sel.className = 'compare-year'; sel.name = 'year[]';
            buildSelectOptions(sel, years);
            // choose a default year not already selected if possible
            const selected = getCurrentSelects().map(s=>s.value);
            const choice = years.find(y=> !selected.includes(y)) || years[0];
            sel.value = choice;
            lbl.appendChild(sel);
            selectsContainer.appendChild(lbl);
            // show remove if now > 2
            removeBtn.style.display = getCurrentSelects().length > 2 ? 'inline-flex' : 'none';
        }

        function removeCompareYear(){
            const selects = getCurrentSelects();
            if(selects.length <= 2) return;
            const last = selects[selects.length - 1];
            const parent = last.closest('label') || last.parentElement;
            if(parent) parent.remove();
            removeBtn.style.display = getCurrentSelects().length > 2 ? 'inline-flex' : 'none';
        }

        openCompareBtn.addEventListener('click', (e)=>{ e.preventDefault(); openCompareModal(); });
        closeBtnC && closeBtnC.addEventListener('click', (e)=>{ e.preventDefault(); closeCompareModal(); });
        cancelBtnC && cancelBtnC.addEventListener('click', (e)=>{ e.preventDefault(); closeCompareModal(); });
        compareModal.addEventListener('click', (e)=>{ if(e.target === compareModal) closeCompareModal(); });
        document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape' && compareModal.getAttribute('aria-hidden') === 'false') closeCompareModal(); });

        addBtn && addBtn.addEventListener('click', (e)=>{ e.preventDefault(); addCompareYear(); });
        removeBtn && removeBtn.addEventListener('click', (e)=>{ e.preventDefault(); removeCompareYear(); });

        function buildYearSeriesFor(year){
            // returns array length 12 with values (null beyond last invoice month)
            const raw = localStorage.getItem('ecohome_invoices_v1');
            let invoices = raw ? JSON.parse(raw) : [];
            if(!Array.isArray(invoices)) invoices = [];
            const agg = {};
            invoices.forEach(inv=>{
                const m = String(inv.month||'').trim();
                if(!m) return;
                let yPart = '';
                let monthNum = 0;
                if(m.indexOf('-') !== -1){ const parts = m.split('-'); yPart = String(parts[0]); monthNum = Number(parts[1]) || 0; }
                else { const n = Number(m) || 0; if(String(n).length === 4){ yPart = String(n); } else { monthNum = n; } }
                if(String(year) !== String(yPart)) return;
                if(monthNum < 1 || monthNum > 12) return;
                agg[monthNum] = (agg[monthNum] || 0) + (Number(inv.consumption) || 0);
            });
            const monthsAll = Array.from({length:12},(_,i)=>i+1);
            const monthsPresent = Object.keys(agg).map(n=>Number(n)).filter(n=>n>=1 && n<=12);
            const maxMonth = monthsPresent.length ? Math.max(...monthsPresent) : 0;
            return monthsAll.map(m=> m<=maxMonth ? Number((agg[m]||0).toFixed(2)) : null);
        }

        formC && formC.addEventListener('submit', (e)=>{
            e.preventDefault();
            const selects = getCurrentSelects();
            const yearsSelected = selects.map(s=> s.value).filter(Boolean);
            if(yearsSelected.length < 2){ alert('Seleccione pelo menos dois anos'); return; }
            const labels = Array.from({length:12},(_,i)=>String(i+1));
            const datasets = [];
            const colors = getColors(yearsSelected.length);
            yearsSelected.forEach((yr, idx)=>{
                const data = buildYearSeriesFor(yr);
                datasets.push({ label: `${yr} - Consumo (kWh)`, data, borderColor: colors[idx] || '#2563eb', backgroundColor: 'rgba(0,0,0,0)', tension:0.3, fill:false, pointRadius:4 });
            });
            const dataLocal = { labels, datasets };
            if(compareChart){ compareChart.data = dataLocal; compareChart.update(); }
            else {
                compareChart = new Chart(compareCtx, {
                    type: 'line', data: dataLocal,
                    options: {
                        responsive:true, maintainAspectRatio:false,
                        interaction:{mode:'index',intersect:false},
                        plugins:{
                            legend:{display:true, position:'top'},
                            tooltip:{
                                callbacks:{
                                    title:(ctx)=>{ const idx = ctx[0].dataIndex; return `Mês ${idx+1}`; },
                                    label:(ctx)=>{ const v = ctx.raw; if(v===null||typeof v==='undefined') return `${ctx.dataset.label}: —`; return `${ctx.dataset.label}: ${Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})} kWh`; },
                                    footer:(tooltipItems)=>{
                                        if(!tooltipItems || !tooltipItems.length) return '';
                                        const idx = tooltipItems[0].dataIndex;
                                        const base = (compareChart && compareChart.data && compareChart.data.datasets[0]) ? compareChart.data.datasets[0].data[idx] : null;
                                        if(base === null || typeof base === 'undefined') return '';
                                        const lines = [];
                                        for(let i=1;i<compareChart.data.datasets.length;i++){
                                            const other = compareChart.data.datasets[i].data[idx];
                                            const aVal = Number(base || 0);
                                            const bVal = Number(other || 0);
                                            const diff = Number((bVal - aVal).toFixed(2));
                                            const pct = (aVal !== 0) ? Number(((diff / aVal) * 100).toFixed(2)) : null;
                                            const diffStr = `Diff ${compareChart.data.datasets[i].label.replace(' - Consumo (kWh)','')} vs ${compareChart.data.datasets[0].label.replace(' - Consumo (kWh)','')}: ${diff.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})} kWh`;
                                            const pctStr = pct === null ? ' (N/A%)' : ` (${pct}%)`;
                                            lines.push(diffStr + pctStr);
                                        }
                                        return lines;
                                    }
                                }
                            }
                        },
                        scales:{ y:{ beginAtZero:true }, x:{ title:{display:true, text:'Mês' } } }
                    }
                });
            }
            // show remove button if needed
            removeBtn.style.display = getCurrentSelects().length > 2 ? 'inline-flex' : 'none';
        });
    }
});

// Modal logic for profile page: Novo / Editar Equipamento
(() => {
    const modal = document.getElementById('newEquipmentModal');
    if(!modal) return; // nothing to do when modal not present

    const openBtn = document.querySelector('.open-new-equipment');
    const closeBtn = modal.querySelector('.modal-close');
    const cancelBtn = modal.querySelector('.modal-cancel');
    const saveBtn = modal.querySelector('.modal-save');
    const form = document.getElementById('newEquipmentForm');
    const tbody = document.getElementById('equipmentTableBody');

    let editingRow = null; // when editing, points to the <tr>
    // delete confirmation modal handling
    const confirmModal = document.getElementById('confirmDeleteModal');
    const confirmYesBtn = confirmModal ? confirmModal.querySelector('.confirm-delete-yes') : null;
    const confirmCancelBtn = confirmModal ? confirmModal.querySelector('.confirm-delete-cancel') : null;
    const confirmCloseBtn = confirmModal ? confirmModal.querySelector('.modal-close') : null;
    let pendingDeleteRow = null;

    function energyToBadgeClass(energy){
        if(!energy) return 'energy-a';
        const m = energy.replace('+','plus'); // not used but keep safe
        switch(energy.trim()){
            case 'A+++': return 'energy-a3';
            case 'A++': return 'energy-a2';
            case 'A+': return 'energy-a1';
            case 'A': return 'energy-a';
            case 'B': return 'energy-b';
            case 'C': return 'energy-c';
            case 'D': return 'energy-d';
            case 'E': return 'energy-e';
            case 'F': return 'energy-f';
            case 'G': return 'energy-g';
            default: return 'energy-a';
        }
    }

    function createRowElement(data){
        const tr = document.createElement('tr');
        tr.setAttribute('draggable','true');
        const badgeClass = energyToBadgeClass(data.class);
        tr.innerHTML = `
            <td class="drag-handle-cell" style="padding:12px;border-bottom:1px solid #f1f5f9"><span class="drag-handle" title="Reordenar">☰</span></td>
            <td style="padding:12px;border-bottom:1px solid #f1f5f9">${escapeHtml(data.name)}</td>
            <td style="padding:12px;border-bottom:1px solid #f1f5f9">${escapeHtml(data.power)}</td>
            <td style="padding:12px;border-bottom:1px solid #f1f5f9"><span class="energy-badge ${badgeClass}">${escapeHtml(data.class)}</span></td>
            <td style="padding:12px;border-bottom:1px solid #f1f5f9">${escapeHtml(data.hours)}</td>
            <td style="padding:12px;border-bottom:1px solid #f1f5f9">${escapeHtml(data.room)}</td>
            <td style="padding:12px;border-bottom:1px solid #f1f5f9">
                <button class="icon-btn action-edit" title="Editar">✎</button>
                <button class="icon-btn action-delete" title="Eliminar">🗑️</button>
            </td>
        `;
        return tr; // Ensure createRowElement returns tr
    }

    function escapeHtml(s){
        if(s === null || s === undefined) return '';
        return String(s).replace(/[&<>"']/g, (c)=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    // Persistence: load/save from localStorage
    const STORAGE_KEY = 'ecohome_equipments_v1';

    function persistTable(){
        if(!tbody) return;
        const rows = Array.from(tbody.querySelectorAll('tr'));
        const arr = rows.map(r=>{
            const cells = r.querySelectorAll('td');
            // support optional drag-handle cell at index 0
            const hasHandle = cells[0] && cells[0].classList && cells[0].classList.contains('drag-handle-cell');
            const offset = hasHandle ? 1 : 0;
            const clsSpan = cells[offset+2] ? cells[offset+2].querySelector('.energy-badge') : null;
            return {
                name: cells[offset+0].innerText.trim(),
                power: cells[offset+1].innerText.trim(),
                class: clsSpan ? clsSpan.innerText.trim() : (cells[offset+2] ? cells[offset+2].innerText.trim() : ''),
                hours: cells[offset+3] ? cells[offset+3].innerText.trim() : '',
                room: cells[offset+4] ? cells[offset+4].innerText.trim() : ''
            };
        });
        try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); }catch(e){ console.warn('storage error',e); }
        // update metrics whenever table is persisted
        updateMetrics();
        // refresh natural order snapshot after persistence
        try{ setNaturalOrder(); }catch(e){}
    }

    // Update metrics: total equipments and consumption sums
    function updateMetrics(){
        if(!tbody) return;
        const rows = Array.from(tbody.querySelectorAll('tr'));
        const total = rows.length;
        let sumPowerW = 0;
        let estimatedMonthlyKwh = 0;
        rows.forEach(r=>{
            const cells = r.querySelectorAll('td');
            const hasHandle = cells[0] && cells[0].classList && cells[0].classList.contains('drag-handle-cell');
            const offset = hasHandle ? 1 : 0;
            const powerText = (cells[offset+1] && cells[offset+1].innerText) ? cells[offset+1].innerText : '';
            const hoursText = (cells[offset+3] && cells[offset+3].innerText) ? cells[offset+3].innerText : '';
            const power = parseFloat(String(powerText).replace(/[^0-9\.\-]/g,'')) || 0;
            const hours = parseFloat(String(hoursText).replace(/[^0-9\.\-]/g,'')) || 0;
            sumPowerW += power;
            // estimate monthly energy: power (W) * hours/day * 30 days -> Wh -> /1000 -> kWh
            estimatedMonthlyKwh += (power * hours * 30) / 1000;
        });
        const totalEl = document.getElementById('totalEquipmentsValue');
        const kwhEl = document.getElementById('estimatedMonthlyKwh');
        const countEl = document.getElementById('equipmentsCount');
        if(totalEl) totalEl.textContent = String(total);
        if(kwhEl) kwhEl.textContent = `${estimatedMonthlyKwh.toFixed(2)} kWh`;
        if(countEl) countEl.textContent = `(${String(total)})`;
    }

    function loadFromStorageOrDom(){
        let saved = null;
        try{ saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); }catch(e){ saved = null; }
        if(!tbody) return; // nothing to render on pages without the table
        if(saved && Array.isArray(saved)){
            // clear current rows and render saved
            tbody.innerHTML = '';
            saved.forEach(item=> tbody.appendChild(createRowElement(item)));
            return;
        }
        // fallback: use existing DOM rows as initial data (do nothing)
    }

    // helper: add equipment directly to localStorage when there's no table in DOM
    function addEquipmentToStorage(data){
        try{
            const raw = localStorage.getItem(STORAGE_KEY);
            let arr = raw ? JSON.parse(raw) : [];
            if(!Array.isArray(arr)) arr = [];
            arr.push(data);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
        }catch(e){ console.warn('addEquipmentToStorage failed', e); }
        // Force charts to be rebuilt and updated so UI reflects the new equipment immediately
        try{ pieChart = null; barChart = null; }catch(e){}
        try{ createOrUpdateCharts(); }catch(e){ console.warn('createOrUpdateCharts failed after add', e); }
        try{ updateMetrics(); }catch(e){ console.warn('updateMetrics failed after add', e); }
        // some chart updates may require a small delay to ensure DOM/Chart.js sync
        try{ setTimeout(()=>{ try{ if(typeof pieChart !== 'undefined' && pieChart) pieChart.update(); if(typeof barChart !== 'undefined' && barChart) barChart.update(); }catch(err){} }, 60); }catch(e){}
    }

    // initial load
    loadFromStorageOrDom();
    // initial metrics update
    updateMetrics();

    // respond to storage changes from other tabs/windows: refresh table when equipments storage updated
    try{ window.addEventListener('storage', (e)=>{ if(e.key === STORAGE_KEY) { try{ loadFromStorageOrDom(); try{ updateMetrics(); }catch(err){} try{ setNaturalOrder(); }catch(err){} }catch(err){} } }); }catch(e){}

    // Natural order snapshot (used to restore order after sorting)
    let naturalOrder = Array.from(tbody ? tbody.querySelectorAll('tr') : []);
    function setNaturalOrder(){
        naturalOrder = Array.from(tbody ? tbody.querySelectorAll('tr') : []);
    }
    setNaturalOrder();

    // header click sorting: cycle Desc -> Asc -> Natural
    const header = tbody && tbody.closest('table') ? tbody.closest('table').querySelector('thead tr') : null;
    const headerStates = {}; // colIndex -> 0 natural, 1 desc, 2 asc
    function clearOtherHeaderStates(exceptIdx){
        if(!header) return;
        const ths = header.querySelectorAll('th');
        ths.forEach((th,i)=>{ if(i!==exceptIdx) { th.removeAttribute('data-sort'); headerStates[i]=0; th.classList.remove('sorted-desc','sorted-asc'); } });
    }
    if(header){
        const ths = Array.from(header.querySelectorAll('th'));
        ths.forEach((th, colIndex)=>{
            // skip handle column (0) and actions column (last)
            if(colIndex === 0 || colIndex === ths.length - 1){
                th.style.cursor = 'default';
                headerStates[colIndex] = 0;
                return;
            }
            th.style.cursor = 'pointer';
            th.addEventListener('click', ()=>{
                // determine next state
                const current = headerStates[colIndex] || 0;
                const next = (current === 0) ? 1 : (current === 1 ? 2 : 0);
                headerStates[colIndex] = next;
                // clear others
                clearOtherHeaderStates(colIndex);
                // apply visual marker
                th.classList.remove('sorted-desc','sorted-asc');
                if(next === 1) th.classList.add('sorted-desc');
                if(next === 2) th.classList.add('sorted-asc');

                // compute data cell index mapping: header colIndex corresponds to td index
                const dataIndex = colIndex; // because first header matches first td (handle)
                // collect rows
                const rows = Array.from(tbody.querySelectorAll('tr'));
                if(next === 0){
                    // restore natural order snapshot
                    setTimeout(()=>{
                        naturalOrder.forEach(r=>{ if(tbody.contains(r)) tbody.appendChild(r); });
                    },0);
                    return;
                }

                // sorting function
                // Column indices: 0 handle, 1 Nome, 2 Potência (numeric), 3 Classe (energy), 4 Horas/Dia (numeric), 5 Divisão, 6 Ações
                const isNumericCol = (dataIndex === 2 || dataIndex === 4);
                const isClassCol = (dataIndex === 3);
                const energyOrder = ['A+++','A++','A+','A','B','C','D','E','F','G'];
                rows.sort((a,b)=>{
                    const ca = a.querySelectorAll('td');
                    const cb = b.querySelectorAll('td');
                    const va = (ca[dataIndex] && ca[dataIndex].innerText) ? ca[dataIndex].innerText.trim() : '';
                    const vb = (cb[dataIndex] && cb[dataIndex].innerText) ? cb[dataIndex].innerText.trim() : '';
                    if(isClassCol){
                        const ra = energyOrder.indexOf(va) >= 0 ? energyOrder.indexOf(va) : energyOrder.length;
                        const rb = energyOrder.indexOf(vb) >= 0 ? energyOrder.indexOf(vb) : energyOrder.length;
                        // first click (next===1): best -> worst (smaller index first). second click: reverse.
                        return (next === 1 ? 1 : -1) * (ra - rb);
                    } else if(isNumericCol){
                        const na = parseFloat(va.replace(/[^0-9.\-]/g,'')) || 0;
                        const nb = parseFloat(vb.replace(/[^0-9.\-]/g,'')) || 0;
                        // numeric: first click should go from largest -> smallest (desc) -> so next===1 => multiplier -1
                        const multiplier = (next === 1) ? -1 : 1;
                        return multiplier * (na - nb);
                    } else {
                        // text columns: first click A->Z (asc), second click Z->A (desc)
                        const multiplier = (next === 1) ? 1 : -1;
                        return multiplier * va.localeCompare(vb, 'pt-BR', {sensitivity:'base'});
                    }
                });
                // append in new order (do not update naturalOrder)
                rows.forEach(r=> tbody.appendChild(r));
            });
        });
    }

    function openModal(mode='new'){
        if(mode === 'new'){
            modal.querySelector('#modalTitle').textContent = 'Novo Equipamento';
            editingRow = null;
            form.reset();
        } else {
            modal.querySelector('#modalTitle').textContent = 'Editar Equipamento';
        }
        modal.setAttribute('aria-hidden','false');
        const first = modal.querySelector('input, select, button');
        if(first) first.focus();
    }

    function closeModal(){
        modal.setAttribute('aria-hidden','true');
        if(openBtn) openBtn.focus();
    }

    // open new
    openBtn && openBtn.addEventListener('click', (e)=>{ e.preventDefault(); openModal('new'); });
    closeBtn && closeBtn.addEventListener('click', (e)=>{ e.preventDefault(); closeModal(); });
    cancelBtn && cancelBtn.addEventListener('click', (e)=>{ e.preventDefault(); closeModal(); });

    // close when clicking outside modal content
    modal.addEventListener('click', (e)=>{ if(e.target === modal) closeModal(); });

    // confirm modal helpers
    function openConfirmModalForRow(tr){
        if(!confirmModal) return;
        pendingDeleteRow = tr;
        confirmModal.setAttribute('aria-hidden','false');
        const focusEl = confirmYesBtn || confirmCancelBtn || confirmCloseBtn;
        if(focusEl) focusEl.focus();
    }
    function closeConfirmModal(){
        if(!confirmModal) return;
        confirmModal.setAttribute('aria-hidden','true');
        pendingDeleteRow = null;
    }
    if(confirmModal){
        confirmModal.addEventListener('click', (e)=>{ if(e.target === confirmModal) closeConfirmModal(); });
        confirmCancelBtn && confirmCancelBtn.addEventListener('click', (e)=>{ e.preventDefault(); closeConfirmModal(); });
        confirmCloseBtn && confirmCloseBtn.addEventListener('click', (e)=>{ e.preventDefault(); closeConfirmModal(); });
        confirmYesBtn && confirmYesBtn.addEventListener('click', (e)=>{
            e.preventDefault();
            if(pendingDeleteRow){
                pendingDeleteRow.remove();
                persistTable();
                pendingDeleteRow = null;
            }
            closeConfirmModal();
        });
    }

    // delegation for edit/delete buttons in the table
    tbody && tbody.addEventListener('click', (e)=>{
        const editBtn = e.target.closest('.action-edit');
        if(editBtn){
            const tr = editBtn.closest('tr');
            if(!tr) return;
            // populate form from row
            const cells = tr.querySelectorAll('td');
            const hasHandle = cells[0] && cells[0].classList && cells[0].classList.contains('drag-handle-cell');
            const offset = hasHandle ? 1 : 0;
            const name = cells[offset + 0].innerText.trim();
            const power = cells[offset + 1].innerText.trim();
            const clsSpan = cells[offset + 2] ? cells[offset + 2].querySelector('.energy-badge') : null;
            const cls = clsSpan ? clsSpan.innerText.trim() : (cells[offset + 2] ? cells[offset + 2].innerText.trim() : '');
            const hours = cells[offset + 3] ? cells[offset + 3].innerText.trim() : '';
            const room = cells[offset + 4] ? cells[offset + 4].innerText.trim() : '';
            // set form values
            form.elements['name'].value = name;
            form.elements['power'].value = power.replace(/[^0-9.]/g,'');
            form.elements['class'].value = cls;
            form.elements['hours'].value = hours.replace(/[^0-9.]/g,'');
            form.elements['room'].value = room;
            editingRow = tr;
            openModal('edit');
            return;
        }
        const delBtn = e.target.closest('.action-delete');
        if(delBtn){
            const tr = delBtn.closest('tr');
            if(!tr) return;
            // abrir modal de confirmação em-app
            if(confirmModal){
                openConfirmModalForRow(tr);
            } else {
                // fallback para caso modal não exista
                if(confirm('Eliminar este equipamento?')){
                    tr.remove();
                    persistTable();
                }
            }
            return;
        }
    });

    // Drag & drop reordering (only when starting drag from the handle)
    let draggingRow = null;
    function getDragAfterElement(container, y){
        const draggableElements = [...container.querySelectorAll('tr:not(.dragging)')];
        const closest = draggableElements.reduce((closest, child)=>{
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset, element: child };
            } else return closest;
        }, { offset: Number.NEGATIVE_INFINITY });
        return closest.element || null;
    }

    if(tbody){
        // handle active flag: if user presses the handle, mark row as handle-active
        function clearHandleActive(){
            const active = tbody.querySelectorAll('.drag-handle.active');
            active.forEach(h=> h.classList.remove('active'));
            const trs = tbody.querySelectorAll('tr');
            trs.forEach(r=> r.removeAttribute('data-handle-active'));
        }

        tbody.addEventListener('mousedown', (e)=>{
            const handle = e.target.closest('.drag-handle');
            if(!handle) return;
            const tr = handle.closest('tr');
            if(!tr) return;
            // mark active while mouse is down; will be cleared on mouseup
            handle.classList.add('active');
            tr.setAttribute('data-handle-active','true');
        });
        // clear on mouseup anywhere
        document.addEventListener('mouseup', ()=>{ clearHandleActive(); });
        // support touchend
        document.addEventListener('touchend', ()=>{ clearHandleActive(); });

        tbody.addEventListener('dragstart', (e)=>{
            const tr = e.target.closest('tr');
            if(!tr) return;
            // allow dragging when initiated from the handle OR when handle was activated by mousedown
            const handle = e.target.closest('.drag-handle');
            const handleActive = tr.getAttribute('data-handle-active') === 'true';
            if(!(handle || handleActive)){
                e.preventDefault();
                return;
            }
            draggingRow = tr;
            tr.classList.add('dragging');
            try{ e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ''); }catch(err){}
        });

        let currentDropTarget = null;
        // create a single drop indicator element that highlights only the bottom edge of the target row
        const tableWrapper = tbody.parentElement || tbody;
        try{ if(window.getComputedStyle(tableWrapper).position === 'static') tableWrapper.style.position = 'relative'; }catch(e){}
        const dropIndicator = document.createElement('div');
        dropIndicator.className = 'drop-indicator';
        tableWrapper.appendChild(dropIndicator);

        // track the last computed insertion point but don't move DOM until drop
        let lastAfterElement = null;

        tbody.addEventListener('dragover', (e)=>{
            e.preventDefault();
            if(!draggingRow) return;
            const afterElement = getDragAfterElement(tbody, e.clientY);
            lastAfterElement = afterElement || null;

            // determine visual target (row that would be shifted)
            let visualTarget = afterElement;
            if(!visualTarget){
                const last = tbody.querySelector('tr:last-child');
                if(last && last !== draggingRow) visualTarget = last;
            }

            if(visualTarget && visualTarget !== draggingRow){
                currentDropTarget = visualTarget;
                // compute position relative to wrapper
                const targetRect = visualTarget.getBoundingClientRect();
                const wrapperRect = tableWrapper.getBoundingClientRect();
                let topPos;
                // if inserting at end (no afterElement) and visualTarget is the last row,
                // place indicator after the last row (bottom). Otherwise place at the top edge.
                if(!afterElement){
                    // inserting at end: show indicator after last row
                    topPos = targetRect.bottom - wrapperRect.top;
                } else {
                    // show indicator at top edge of visual target
                    topPos = targetRect.top - wrapperRect.top;
                }
                dropIndicator.style.top = (topPos) + 'px';
                dropIndicator.style.opacity = '1';
            } else {
                dropIndicator.style.opacity = '0';
                currentDropTarget = null;
            }
        });

        tbody.addEventListener('dragend', (e)=>{
            // on drop, insert the dragging row at the last computed position
            if(lastAfterElement == null){
                tbody.appendChild(draggingRow);
            } else if(lastAfterElement && draggingRow){
                // if lastAfterElement exists, insert before it
                tbody.insertBefore(draggingRow, lastAfterElement);
            }
            // cleanup indicator and state
            dropIndicator.style.opacity = '0';
            lastAfterElement = null;
            currentDropTarget = null;
            if(draggingRow){
                draggingRow.classList.remove('dragging');
                draggingRow = null;
                // persist new order
                persistTable();
            }
        });
    }

    // save handler: add or update
    saveBtn && saveBtn.addEventListener('click', (e)=>{
        e.preventDefault();
        const data = {
            name: (form.elements['name'].value||'').trim(),
            power: (form.elements['power'].value||'').trim() + (form.elements['power'].value? 'W':'').trim(),
            class: (form.elements['class'].value||'').trim(),
            hours: (form.elements['hours'].value||'').trim() + (form.elements['hours'].value? 'h':'').trim(),
            room: (form.elements['room'].value||'').trim()
        };
        // basic validation
        if(!data.name){ alert('Nome do equipamento é obrigatório'); return; }

        if(editingRow){
            const cells = editingRow.querySelectorAll('td');
            const hasHandle = cells[0] && cells[0].classList && cells[0].classList.contains('drag-handle-cell');
            const offset = hasHandle ? 1 : 0;
            cells[offset + 0].textContent = data.name;
            cells[offset + 1].textContent = data.power;
            // replace class cell
            const badgeClass = energyToBadgeClass(data.class);
            cells[offset + 2].innerHTML = `<span class="energy-badge ${badgeClass}">${escapeHtml(data.class)}</span>`;
            cells[offset + 3].textContent = data.hours;
            cells[offset + 4].textContent = data.room;
            // persistir alteração após edição
            persistTable();
        } else {
            if(tbody){
                const tr = createRowElement(data);
                tbody.appendChild(tr);
                // persistir nova linha
                    persistTable();
                    // forçar reload completo da página para garantir atualização de gráficos
                    try{ location.reload(); }catch(e){}
            } else {
                // no table in this page (e.g., index) — persist directly to storage
                addEquipmentToStorage(data);
                // garantir reload quando equipamento criado fora da página de perfil
                try{ location.reload(); }catch(e){}
            }
        }

        closeModal();
    });

})();

// Modal & lógica de edição do perfil (carregar/editar/gravar em localStorage)
(() => {
    const modal = document.getElementById('editProfileModal');
    if(!modal) return;

    const openBtn = document.querySelector('.edit-profile-btn');
    const closeBtn = modal.querySelector('.modal-close');
    const cancelBtn = modal.querySelector('.modal-cancel');
    const saveBtn = modal.querySelector('#saveProfileBtn');
    const form = document.getElementById('editProfileForm');

    const nameInput = document.getElementById('profileNameInput');
    const emailInput = document.getElementById('profileEmailInput');
    const phoneInput = document.getElementById('profilePhoneInput');

    const nameVal = document.getElementById('profileNameValue');
    const emailVal = document.getElementById('profileEmailValue');
    const phoneVal = document.getElementById('profilePhoneValue');

    const USER_KEY = 'ecohome_user_v1';

    function loadUser(){
        try{
            const raw = localStorage.getItem(USER_KEY);
            if(raw){
                const u = JSON.parse(raw);
                if(u && typeof u === 'object'){
                    if(nameVal) nameVal.textContent = u.name || nameVal.textContent;
                    if(emailVal) emailVal.textContent = u.email || emailVal.textContent;
                    if(phoneVal) phoneVal.textContent = u.phone || phoneVal.textContent;
                }
            }
        }catch(e){ /* ignore */ }
    }

    function openModal(){
        if(nameInput) nameInput.value = nameVal ? nameVal.textContent.trim() : '';
        if(emailInput) emailInput.value = emailVal ? emailVal.textContent.trim() : '';
        if(phoneInput) phoneInput.value = phoneVal ? phoneVal.textContent.trim() : '';
        modal.setAttribute('aria-hidden','false');
        const first = modal.querySelector('input'); if(first) first.focus();
    }

    function closeModal(){
        modal.setAttribute('aria-hidden','true');
    }

    if(openBtn) openBtn.addEventListener('click', (e)=>{ e && e.preventDefault && e.preventDefault(); openModal(); });
    if(closeBtn) closeBtn.addEventListener('click', (e)=>{ e && e.preventDefault && e.preventDefault(); closeModal(); });
    if(cancelBtn) cancelBtn.addEventListener('click', (e)=>{ e && e.preventDefault && e.preventDefault(); closeModal(); });

    // clicar fora fecha
    modal.addEventListener('click', function onOutside(ev){ if(ev.target === modal){ closeModal(); } });
    // ESC fecha
    document.addEventListener('keydown', function escListener(ev){ if(ev.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false'){ closeModal(); } });

    if(saveBtn){
        saveBtn.addEventListener('click', (e)=>{
            e && e.preventDefault && e.preventDefault();
            const data = {
                name: (nameInput && nameInput.value || '').trim(),
                email: (emailInput && emailInput.value || '').trim(),
                phone: (phoneInput && phoneInput.value || '').trim()
            };
            if(!data.name){ alert('Nome é obrigatório'); return; }
            try{ localStorage.setItem(USER_KEY, JSON.stringify(data)); }catch(err){ console.warn('save user failed', err); }
            if(nameVal) nameVal.textContent = data.name;
            if(emailVal) emailVal.textContent = data.email;
            if(phoneVal) phoneVal.textContent = data.phone;
            closeModal();
        });
    }

    // inicializar
    loadUser();
})();

// Help Modal (works on both index and profile pages)
(() => {
    const openHelpBtn = document.getElementById('openHelpBtn');
    const helpModal = document.getElementById('helpModal');
    if(openHelpBtn && helpModal){
        const closeHelpBtn = helpModal.querySelector('.modal-close');
        openHelpBtn.addEventListener('click', (e)=>{ 
            e.preventDefault(); 
            helpModal.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
        });
        if(closeHelpBtn){
            closeHelpBtn.addEventListener('click', ()=>{ 
                helpModal.setAttribute('aria-hidden', 'true');
                document.body.style.overflow = '';
            });
        }
        helpModal.addEventListener('click', (e)=>{ 
            if(e.target === helpModal){ 
                helpModal.setAttribute('aria-hidden', 'true');
                document.body.style.overflow = '';
            }
        });
        document.addEventListener('keydown', (e)=>{ 
            if(e.key === 'Escape' && helpModal.getAttribute('aria-hidden') === 'false'){ 
                helpModal.setAttribute('aria-hidden', 'true');
                document.body.style.overflow = '';
            }
        });
    }
})();
// Logout button (profile page)
(() => {
    const logoutBtn = document.getElementById('logoutBtn');
    if(logoutBtn){
        logoutBtn.addEventListener('click', (e)=>{
            e && e.preventDefault && e.preventDefault();
            // simple client-side logout: redirect to login page
            window.location.href = 'login.html';
        });
    }
})();