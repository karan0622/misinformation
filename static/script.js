document.addEventListener('DOMContentLoaded', () => {
    const claimInput = document.getElementById('claimInput');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const resetBtn = document.getElementById('resetBtn');
    
    const searchSection = document.querySelector('.search-section');
    const loadingState = document.getElementById('loadingState');
    const resultState = document.getElementById('resultState');
    
    const loadingStatus = document.getElementById('loadingStatus');

    let spreadMap = null;
    let mapMarkers = [];
    let globeInstance = null;
    let lastSpreadLocations = [];
    let lastClaim = '';  // stores the current claim for showResults to access


    // ── Globe Modal Logic ───────────────────────────────────────────────────
    const openGlobeBtn = document.getElementById('openGlobeBtn');
    const closeGlobeBtn = document.getElementById('closeGlobeBtn');
    const globeModal = document.getElementById('globeModal');

    openGlobeBtn.addEventListener('click', () => {
        if (!lastSpreadLocations.length) return;
        globeModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        renderGlobe(lastSpreadLocations);
    });

    closeGlobeBtn.addEventListener('click', () => {
        globeModal.classList.add('hidden');
        document.body.style.overflow = '';
    });

    globeModal.addEventListener('click', (e) => {
        if (e.target === globeModal) {
            globeModal.classList.add('hidden');
            document.body.style.overflow = '';
        }
    });

    function renderGlobe(locations) {
        const container = document.getElementById('globeContainer');
        container.innerHTML = '';

        const W = container.clientWidth || 800;
        const H = container.clientHeight || 500;

        // Build graph nodes and links (fully connected mesh)
        const nodes = locations.map((loc, i) => ({
            id: i,
            label: loc.location,
            value: loc.value || 50,
            intensity: loc.intensity,
            color: loc.intensity === 'high' ? '#ef4444' : (loc.intensity === 'medium' ? '#f59e0b' : '#3b82f6')
        }));

        const links = [];
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                links.push({ source: i, target: j,
                    color: (nodes[i].intensity === 'high' || nodes[j].intensity === 'high') ? '#ef444450' : '#3b82f630'
                });
            }
        }

        const svg = d3.select(container)
            .append('svg')
            .attr('width', W)
            .attr('height', H)
            .style('background', '#030712');

        // Glow filter
        const defs = svg.append('defs');
        ['red','blue','amber'].forEach((name, i) => {
            const col = ['#ef4444','#3b82f6','#f59e0b'][i];
            const filter = defs.append('filter').attr('id', `glow-${name}`);
            filter.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'coloredBlur');
            const feMerge = filter.append('feMerge');
            feMerge.append('feMergeNode').attr('in', 'coloredBlur');
            feMerge.append('feMergeNode').attr('in', 'SourceGraphic');
        });

        // Background grid
        const gridGroup = svg.append('g').attr('opacity', 0.06);
        for (let x = 0; x < W; x += 40) {
            gridGroup.append('line').attr('x1', x).attr('y1', 0).attr('x2', x).attr('y2', H).attr('stroke', '#60a5fa').attr('stroke-width', 0.5);
        }
        for (let y = 0; y < H; y += 40) {
            gridGroup.append('line').attr('x1', 0).attr('y1', y).attr('x2', W).attr('y2', y).attr('stroke', '#60a5fa').attr('stroke-width', 0.5);
        }

        // Force simulation
        const simulation = d3.forceSimulation(nodes)
            .force('link', d3.forceLink(links).id(d => d.id).distance(120))
            .force('charge', d3.forceManyBody().strength(-300))
            .force('center', d3.forceCenter(W / 2, H / 2))
            .force('collision', d3.forceCollide().radius(40));

        // Draw links
        const link = svg.append('g')
            .selectAll('line')
            .data(links)
            .join('line')
            .attr('stroke', d => d.color)
            .attr('stroke-width', 1.5)
            .attr('stroke-dasharray', '6 4');

        // Animated dash
        function animateDash() {
            link.attr('stroke-dashoffset', function() {
                return (parseFloat(d3.select(this).attr('stroke-dashoffset') || 0) - 1);
            });
            requestAnimationFrame(animateDash);
        }
        animateDash();

        // Node groups
        const node = svg.append('g')
            .selectAll('g')
            .data(nodes)
            .join('g')
            .call(d3.drag()
                .on('start', (event, d) => { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
                .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
                .on('end', (event, d) => { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
            );

        // Outer glow ring
        node.append('circle')
            .attr('r', d => 6 + (d.value / 100) * 16)
            .attr('fill', 'none')
            .attr('stroke', d => d.color)
            .attr('stroke-width', 1)
            .attr('opacity', 0.25)
            .attr('filter', d => `url(#glow-${d.intensity === 'high' ? 'red' : d.intensity === 'medium' ? 'amber' : 'blue'})`);

        // Main circle
        node.append('circle')
            .attr('r', d => 5 + (d.value / 100) * 10)
            .attr('fill', d => d.color + '33')
            .attr('stroke', d => d.color)
            .attr('stroke-width', 2)
            .attr('filter', d => `url(#glow-${d.intensity === 'high' ? 'red' : d.intensity === 'medium' ? 'amber' : 'blue'})`);

        // Labels
        node.append('text')
            .text(d => d.label)
            .attr('x', 0)
            .attr('y', d => -(9 + (d.value / 100) * 10) - 5)
            .attr('text-anchor', 'middle')
            .attr('fill', '#e2e8f0')
            .attr('font-size', '11px')
            .attr('font-family', 'Courier New, monospace')
            .attr('font-weight', '600');

        // Score badge
        node.append('text')
            .text(d => d.value > 0 ? d.value : '')
            .attr('x', 0)
            .attr('y', 4)
            .attr('text-anchor', 'middle')
            .attr('fill', d => d.color)
            .attr('font-size', '10px')
            .attr('font-family', 'Courier New, monospace')
            .attr('font-weight', '700');

        // ── Node Tooltip on click ──────────────────────────────────────────
        // Create floating HTML tooltip inside the container
        const tooltip = d3.select(container)
            .append('div')
            .attr('class', 'node-tooltip')
            .style('position', 'absolute')
            .style('display', 'none')
            .style('background', 'rgba(3,7,18,0.95)')
            .style('border', '1px solid rgba(96,165,250,0.4)')
            .style('border-radius', '10px')
            .style('padding', '12px 16px')
            .style('pointer-events', 'none')
            .style('font-family', 'Courier New, monospace')
            .style('color', '#e2e8f0')
            .style('font-size', '12px')
            .style('line-height', '1.7')
            .style('box-shadow', '0 0 20px rgba(59,130,246,0.25)')
            .style('z-index', '10')
            .style('max-width', '200px');

        // Selection ring (appears on click)
        const selectionRing = node.append('circle')
            .attr('class', 'selection-ring')
            .attr('r', 0)
            .attr('fill', 'none')
            .attr('stroke', d => d.color)
            .attr('stroke-width', 2)
            .attr('stroke-dasharray', '4 3')
            .attr('opacity', 0);

        node.on('click', function(event, d) {
            event.stopPropagation();

            // Reset all rings
            selectionRing.attr('r', 0).attr('opacity', 0);

            // Animate this node's ring
            d3.select(this).select('.selection-ring')
                .attr('r', 28 + (d.value / 100) * 10)
                .attr('opacity', 1);

            const intensityLabel = d.intensity === 'high' ? '🔴 HIGH' : (d.intensity === 'medium' ? '🟠 MEDIUM' : '🔵 LOW');
            const scoreBar = '█'.repeat(Math.round(d.value / 10)) + '░'.repeat(10 - Math.round(d.value / 10));

            tooltip
                .style('display', 'block')
                .style('left', `${d.x + 20}px`)
                .style('top', `${d.y - 20}px`)
                .html(`
                    <div style="color:${d.color};font-weight:700;font-size:13px;margin-bottom:6px">${d.label}</div>
                    <div style="color:#94a3b8;font-size:10px;margin-bottom:8px">INDIA SPREAD NODE</div>
                    <div>Intensity&nbsp;&nbsp;: <span style="color:${d.color}">${intensityLabel}</span></div>
                    <div>Trend Score: <span style="color:${d.color}">${d.value} / 100</span></div>
                    <div style="color:${d.color};letter-spacing:-1px;margin-top:4px;font-size:10px">${scoreBar}</div>
                `);
        });

        // Hide tooltip on background click
        svg.on('click', () => {
            tooltip.style('display', 'none');
            selectionRing.attr('r', 0).attr('opacity', 0);
        });

        simulation.on('tick', () => {
            link
                .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
            node.attr('transform', d => `translate(${d.x},${d.y})`);
            // Keep tooltip pinned to node while simulation runs
            if (tooltip.style('display') !== 'none') {
                const active = nodes.find(n => n.fx != null || n.fy != null);
                if (active) {
                    tooltip.style('left', `${active.x + 20}px`).style('top', `${active.y - 20}px`);
                }
            }
        });
    }


    analyzeBtn.addEventListener('click', async () => {
        lastClaim = claimInput.value.trim();
        const claim = lastClaim;
        if(!claim) return alert('Please enter a claim to analyze.');

        // UI transitions
        searchSection.classList.add('hidden');
        loadingState.classList.remove('hidden');

        const steps = [
            "Extracting Claim Metadata...",
            "Sequencing Linguistic DNA...",
            "Cross-referencing Global Truth Databases...",
            "Detecting Digital Forgery Traces...",
            "Analyzing Mutation Patterns...",
            "Compiling Final Intelligence Report..."
        ];

        let stepIndex = 0;
        const cyberProgressBar = document.getElementById('cyberProgressBar');
        if (cyberProgressBar) cyberProgressBar.style.width = "0%";
        loadingStatus.innerText = steps[0];
        
        const intervalId = setInterval(() => {
            stepIndex++;
            if (stepIndex < steps.length) {
                loadingStatus.innerText = steps[stepIndex];
                if (cyberProgressBar) {
                    cyberProgressBar.style.width = ((stepIndex / steps.length) * 100) + "%";
                }
            } else {
                if (cyberProgressBar) {
                    cyberProgressBar.style.width = "95%";
                }
            }
        }, 1200);

        try {
            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ claim })
            });
            
            clearInterval(intervalId);
            
            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Server returned ${response.status} ${response.statusText}: ${text.slice(0, 100)}...`);
            }
            
            const contentType = response.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) {
                const text = await response.text();
                throw new Error(`Expected JSON but received ${contentType}. Response: ${text.slice(0, 100)}...`);
            }
            
            const data = await response.json();
            showResults(data);
        } catch (err) {
            clearInterval(intervalId);
            alert("Error communicating with server: " + err.message);
            loadingState.classList.add('hidden');
            searchSection.classList.remove('hidden');
        }
    });

    function showResults(data) {
        loadingState.classList.add('hidden');
        resultState.classList.remove('hidden');
        // Show the analysed claim at top of results
        document.getElementById('claimDisplayText').innerText = lastClaim;


        // Fix map loading issue by initializing only when visible
        if (!spreadMap) {
            spreadMap = L.map('spreadMap').setView([20.5937, 78.9629], 4);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
                subdomains: 'abcd',
                maxZoom: 19
            }).addTo(spreadMap);
        } else {
            setTimeout(() => {
                spreadMap.invalidateSize();
            }, 300);
        }

        const verdictBanner = document.getElementById('verdictBanner');
        const isFake = data.verdict.toLowerCase() === 'fake';
        
        verdictBanner.setAttribute('data-verdict', isFake ? 'fake' : 'real');
        
        // Use translated UI header if available, fallback to JS ternary
        if (data.ui_headers) {
            document.getElementById('verdictTitle').innerText = data.ui_headers.verdict || (isFake ? 'Likely Fake' : 'Verified Real');
        } else {
            document.getElementById('verdictTitle').innerText = isFake ? 'Likely Fake' : 'Verified Real';
        }
        
        const confPercent = Math.round(data.confidence * 100) + '%';
        document.getElementById('confidenceScore').innerText = confPercent;
        
        // Timeout for animation effect
        setTimeout(() => {
            document.getElementById('confidenceBar').style.width = confPercent;
        }, 100);

        document.getElementById('explanationText').innerText = data.explanation || "No explanation provided.";
        document.getElementById('truthText').innerText = data.truth || "No truth overview provided.";
        
        if (data.breakdown) {
            document.getElementById('statSource').innerText = data.breakdown.source_reliability || 'N/A';
            document.getElementById('statConsistency').innerText = data.breakdown.factual_consistency || 'N/A';
            document.getElementById('statFallacy').innerText = data.breakdown.logical_fallacies || 'None';
        }
        
        if (data.ui_headers) {
            document.getElementById('headerWhyFake').innerText = data.ui_headers.why_fake || 'Why is it Fake?';
            document.getElementById('headerTruth').innerText = data.ui_headers.actual_truth || 'The Actual Truth';
            document.getElementById('headerCredibility').innerText = data.ui_headers.credibility || 'Credibility Breakdown';
            document.getElementById('labelSource').innerText = data.ui_headers.source_rel || 'Source Reliability';
            document.getElementById('labelConsistency').innerText = data.ui_headers.factual_con || 'Factual Consistency';
            document.getElementById('labelFallacy').innerText = data.ui_headers.log_fallacies || 'Logical Fallacies';
            document.getElementById('headerSources').innerText = data.ui_headers.live_sources || 'Live Web Sources';
            
            if (document.getElementById('headerVirality')) document.getElementById('headerVirality').innerText = data.ui_headers.virality_velocity || 'Virality Velocity';
            if (document.getElementById('headerOrigin')) document.getElementById('headerOrigin').innerText = data.ui_headers.origin_details || 'Origin Details';
            if (document.getElementById('headerMutations')) document.getElementById('headerMutations').innerText = data.ui_headers.language_mutations || 'Known Mutations';
        }

        // Virality — only show real data, never fake
        if (data.virality) {
            const score = data.virality.score_out_of_10;
            const hasRealScore = score !== null && score !== undefined;
            document.getElementById('viralityScore').innerText = hasRealScore ? score : '–';
            setTimeout(() => {
                document.getElementById('viralityBar').style.width = hasRealScore ? (score * 10) + '%' : '0%';
            }, 100);
            document.getElementById('viralityComment').innerText = data.virality.comment || (hasRealScore ? '' : 'No real-time trend data available for this claim.');
        }

        // Origin — show 'Not Found' if no real-time data
        if (data.origin) {
            const platform = data.origin.first_seen_platform || 'Unknown';
            const age = data.origin.age || 'Unknown';
            const platformLower = platform.toLowerCase();
            let platformIcon = '🌐';
            if (platformLower.includes('twitter') || platformLower.includes('x.com')) platformIcon = '🐦';
            else if (platformLower.includes('whatsapp')) platformIcon = '💬';
            else if (platformLower.includes('facebook')) platformIcon = '👥';
            else if (platformLower.includes('youtube')) platformIcon = '▶️';
            else if (platformLower.includes('instagram')) platformIcon = '📸';
            else if (platformLower.includes('telegram')) platformIcon = '✈️';
            else if (platformLower.includes('reddit')) platformIcon = '🔴';
            else if (platformLower.includes('news') || platformLower.includes('times') || platformLower.includes('post') || platformLower.includes('bbc') || platformLower.includes('ndtv') || platformLower.includes('hindustan')) platformIcon = '📰';
            document.getElementById('originPlatform').innerHTML = `${platformIcon} <strong>${platform}</strong>`;
            document.getElementById('originAge').innerHTML = `⏳ First seen: <strong>${age}</strong>`;
        } else {
            document.getElementById('originPlatform').innerHTML = `🔍 <strong>Not found in real-time news data</strong>`;
            document.getElementById('originAge').innerHTML = `⏳ First seen: <strong>Unavailable</strong>`;
        }

        if (data.mutations) {
            const originalObj = typeof data.mutations.original === 'object' ? data.mutations.original : { text: data.mutations.original || lastClaim, link: '#' };
            const hindiObj = typeof data.mutations.hindi === 'object' ? data.mutations.hindi : { text: data.mutations.hindi || 'अनुवाद उपलब्ध नहीं', link: '#' };
            const bengaliObj = typeof data.mutations.bengali === 'object' ? data.mutations.bengali : { text: data.mutations.bengali || 'অনুবাদ উপলব্ধ নয়', link: '#' };

            const getValidLink = (link, text) => (link && link !== '#' && link !== 'Unknown') ? link : `https://www.google.com/search?q=${encodeURIComponent(text)}`;

            document.getElementById('mutOriginal').innerText = originalObj.text;
            const linkOrig = document.getElementById('mutOriginalLink');
            linkOrig.href = getValidLink(originalObj.link, originalObj.text);
            linkOrig.innerText = (originalObj.link && originalObj.link !== '#' && originalObj.link !== 'Unknown') ? 'Source Link' : 'Search Web for Source';
            linkOrig.classList.remove('hidden');

            document.getElementById('mutHindi').innerText = hindiObj.text;
            const linkHindi = document.getElementById('mutHindiLink');
            linkHindi.href = getValidLink(hindiObj.link, hindiObj.text);
            linkHindi.innerText = (hindiObj.link && hindiObj.link !== '#' && hindiObj.link !== 'Unknown') ? 'Source Link' : 'Search Web for Source';
            linkHindi.classList.remove('hidden');

            document.getElementById('mutBengali').innerText = bengaliObj.text;
            const linkBengali = document.getElementById('mutBengaliLink');
            linkBengali.href = getValidLink(bengaliObj.link, bengaliObj.text);
            linkBengali.innerText = (bengaliObj.link && bengaliObj.link !== '#' && bengaliObj.link !== 'Unknown') ? 'Source Link' : 'Search Web for Source';
            linkBengali.classList.remove('hidden');
        }

        // Render Spread Timeline
        if (data.spread_timeline && data.spread_timeline.length) {
            const container = document.getElementById('timelineContainer');
            container.innerHTML = '';
            data.spread_timeline.forEach((event, idx) => {
                const severityColor = event.severity === 'critical' ? '#ef4444' : (event.severity === 'warning' ? '#f59e0b' : '#22c55e');
                const isLast = idx === data.spread_timeline.length - 1;
                const item = document.createElement('div');
                item.className = 'timeline-item';
                item.style.animationDelay = `${idx * 0.12}s`;
                const sourceLink = event.url ? `<a href="${event.url}" target="_blank" rel="noopener" style="display:inline-block;margin-top:5px;font-size:11px;color:#60a5fa;text-decoration:none;border:1px solid #60a5fa44;padding:2px 8px;border-radius:4px;">View Source →</a>` : '';
                item.innerHTML = `
                    <div class="timeline-left">
                        <div class="timeline-dot" style="border-color: ${severityColor}; box-shadow: 0 0 10px ${severityColor}55">
                            ${isLast ? `<span class="timeline-dot-pulse" style="background:${severityColor}"></span>` : ''}
                        </div>
                        ${!isLast ? `<div class="timeline-line"></div>` : ''}
                    </div>
                    <div class="timeline-content">
                        <span class="timeline-meta">${event.day} · ${event.time} &nbsp;·&nbsp; <em>${event.platform}</em></span>
                        <p class="timeline-title" style="color: ${severityColor}">${event.title}</p>
                        <p class="timeline-desc">${event.description} ${sourceLink}</p>
                    </div>`;
                container.appendChild(item);
            });

            // Update velocity bar
            const score = data.virality?.score_out_of_10 || 5;
            const pct = score * 10;
            const bar = document.getElementById('timelineVelocityBar');
            const label = document.getElementById('timelineVelocityLabel');
            setTimeout(() => { bar.style.width = pct + '%'; }, 200);
            if (score >= 8) { bar.style.background = 'linear-gradient(90deg, #ef4444, #f97316)'; label.innerText = 'CRITICAL'; label.style.color = '#ef4444'; }
            else if (score >= 5) { bar.style.background = 'linear-gradient(90deg, #f59e0b, #fbbf24)'; label.innerText = 'HIGH'; label.style.color = '#f59e0b'; }
            else { bar.style.background = 'linear-gradient(90deg, #3b82f6, #60a5fa)'; label.innerText = 'MODERATE'; label.style.color = '#60a5fa'; }
        }

        if (data.spread_locations && spreadMap) {
            lastSpreadLocations = data.spread_locations;
            mapMarkers.forEach(m => spreadMap.removeLayer(m));
            mapMarkers = [];

            // Sort locations by value descending (highest = first detected)
            const sortedLocs = [...data.spread_locations].sort((a, b) => (b.value || 0) - (a.value || 0));

            sortedLocs.forEach(loc => {
                const value = loc.value || 0;
                let radius;
                if (value > 0) {
                    radius = Math.max(6, Math.min(18, value / 100 * 18));
                } else {
                    radius = loc.intensity === 'high' ? 12 : (loc.intensity === 'medium' ? 8 : 5);
                }
                let color = loc.intensity === 'high' ? '#ef4444' : (loc.intensity === 'medium' ? '#f59e0b' : '#3b82f6');

                let marker = L.circleMarker([loc.lat, loc.lng], {
                    radius: radius,
                    fillColor: color,
                    color: color,
                    weight: 2,
                    opacity: 0.9,
                    fillOpacity: 0.55
                }).addTo(spreadMap);

                const scoreText = value > 0 ? `Google Trends Interest: <b>${value}/100</b>` : `Intensity: ${loc.intensity}`;
                marker.bindPopup(`<b style="color:#111">${loc.location}</b><br/><span style="color:#333">${scoreText}</span>`);
                mapMarkers.push(marker);
            });

            // Draw spread path polyline
            if (sortedLocs.length > 1) {
                const pathCoords = sortedLocs.map(l => [l.lat, l.lng]);
                const pathLine = L.polyline(pathCoords, {
                    color: '#60a5fa',
                    weight: 1.5,
                    opacity: 0.35,
                    dashArray: '6 6'
                }).addTo(spreadMap);
                mapMarkers.push(pathLine);
            }

            // ── Newspaper animation along spread path ──────────────────────
            if (sortedLocs.length > 1) {
                const hint = document.getElementById('spreadPathHint');
                const replayBtn = document.getElementById('replaySpreadBtn');
                hint.classList.remove('hidden');
                hint.innerText = '📰 Tracking spread path across states...';
                replayBtn.classList.add('hidden');

                // Outer newsMarker reference kept for replay
                let activeNewsMarker = null;
                let activeInterval = null;

                function startSpreadAnimation(locs) {
                    // Clear previous animation if any
                    if (activeInterval) clearInterval(activeInterval);
                    if (activeNewsMarker) spreadMap.removeLayer(activeNewsMarker);
                    hint.innerText = '📰 Tracking spread path across states...';
                    replayBtn.classList.add('hidden');

                    const newsIcon = L.divIcon({
                        className: '',
                        html: `<div class="newspaper-marker">📰</div>`,
                        iconSize: [28, 28],
                        iconAnchor: [14, 14]
                    });

                    activeNewsMarker = L.marker([locs[0].lat, locs[0].lng], { icon: newsIcon })
                        .addTo(spreadMap);

                    const STEPS = 60;
                    const PAUSE_MS = 800;
                    const STEP_MS = 20;
                    let nodeIdx = 0;
                    let frame = 0;
                    let pausing = false;

                    function moveNewspaper() {
                        if (nodeIdx >= locs.length - 1) return;
                        if (pausing) return;

                        const from = locs[nodeIdx];
                        const to   = locs[nodeIdx + 1];
                        const t    = frame / STEPS;
                        activeNewsMarker.setLatLng([
                            from.lat + (to.lat - from.lat) * t,
                            from.lng + (to.lng - from.lng) * t
                        ]);

                        frame++;
                        if (frame > STEPS) {
                            frame = 0;
                            nodeIdx++;
                            pausing = true;
                            // Pulse the arrival circle marker
                            const arrivalMarker = mapMarkers[nodeIdx];
                            if (arrivalMarker && arrivalMarker.setStyle) {
                                arrivalMarker.setStyle({ fillOpacity: 0.95, weight: 4 });
                                setTimeout(() => arrivalMarker.setStyle({ fillOpacity: 0.55, weight: 2 }), 400);
                            }
                            setTimeout(() => { pausing = false; }, PAUSE_MS);
                        }
                    }

                    activeInterval = setInterval(() => {
                        moveNewspaper();
                        if (nodeIdx >= locs.length - 1 && frame === 0) {
                            clearInterval(activeInterval);
                            hint.innerText = '✅ Spread path traced across ' + locs.length + ' states';
                            replayBtn.classList.remove('hidden');
                        }
                    }, STEP_MS);
                }

                startSpreadAnimation(sortedLocs);

                replayBtn.onclick = () => startSpreadAnimation(sortedLocs);
            }
        }



        const sourcesContainer = document.getElementById('sourcesContainer');
        sourcesContainer.innerHTML = '';
        
        if (data.sources && data.sources.length > 0) {
            data.sources.forEach(src => {
                if (!src.url || src.url === '#') return;
                let domain = '';
                try { domain = new URL(src.url).hostname.replace('www.', ''); } catch(e) {}
                const li = document.createElement('li');
                li.innerHTML = `
                    <div class="source-card">
                        <span class="source-domain">${domain}</span>
                        <a class="source-title" href="${src.url}" target="_blank" rel="noopener">${src.title}</a>
                        ${src.snippet ? `<p class="source-snippet">${src.snippet}</p>` : ''}
                    </div>`;
                sourcesContainer.appendChild(li);
            });
        } else {
            sourcesContainer.innerHTML = '<li><p>No valid live sources found for this claim.</p></li>';
        }
    }

    // Translation Logic
    const translateBtn = document.getElementById('translateBtn');
    const resultLangSelect = document.getElementById('resultLangSelect');
    const translateLoading = document.getElementById('translateLoading');

    translateBtn.addEventListener('click', async () => {
        const lang = resultLangSelect.value;
        const currentExp = document.getElementById('explanationText').innerText;
        const currentTruth = document.getElementById('truthText').innerText;
        const currentBreakdown = {
            source_reliability: document.getElementById('statSource').innerText,
            factual_consistency: document.getElementById('statConsistency').innerText,
            logical_fallacies: document.getElementById('statFallacy').innerText
        };
        const currentHeaders = {
            verdict: document.getElementById('verdictTitle').innerText,
            why_fake: document.getElementById('headerWhyFake').innerText,
            actual_truth: document.getElementById('headerTruth').innerText,
            credibility: document.getElementById('headerCredibility').innerText,
            source_rel: document.getElementById('labelSource').innerText,
            factual_con: document.getElementById('labelConsistency').innerText,
            log_fallacies: document.getElementById('labelFallacy').innerText,
            live_sources: document.getElementById('headerSources').innerText,
            virality_velocity: document.getElementById('headerVirality') ? document.getElementById('headerVirality').innerText : 'Virality Velocity',
            origin_details: document.getElementById('headerOrigin') ? document.getElementById('headerOrigin').innerText : 'Origin Details',
            language_mutations: document.getElementById('headerMutations') ? document.getElementById('headerMutations').innerText : 'Known Mutations'
        };
        const currentVirality = {
            score_out_of_10: document.getElementById('viralityScore') ? parseInt(document.getElementById('viralityScore').innerText) : 0,
            comment: document.getElementById('viralityComment') ? document.getElementById('viralityComment').innerText : ''
        };
        const currentOrigin = {
            first_seen_platform: document.getElementById('originPlatform') ? document.getElementById('originPlatform').innerText : '',
            age: document.getElementById('originAge') ? document.getElementById('originAge').innerText : ''
        };
        const currentMutations = {
            original: {
                text: document.getElementById('mutOriginal') ? document.getElementById('mutOriginal').innerText : '',
                link: document.getElementById('mutOriginalLink') ? document.getElementById('mutOriginalLink').href : '#'
            },
            hindi: {
                text: document.getElementById('mutHindi') ? document.getElementById('mutHindi').innerText : '',
                link: document.getElementById('mutHindiLink') ? document.getElementById('mutHindiLink').href : '#'
            },
            bengali: {
                text: document.getElementById('mutBengali') ? document.getElementById('mutBengali').innerText : '',
                link: document.getElementById('mutBengaliLink') ? document.getElementById('mutBengaliLink').href : '#'
            }
        };

        translateBtn.classList.add('hidden');
        translateLoading.classList.remove('hidden');

        try {
            const response = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    explanation: currentExp, 
                    truth: currentTruth, 
                    breakdown: currentBreakdown, 
                    ui_headers: currentHeaders, 
                    virality: currentVirality,
                    origin: currentOrigin,
                    mutations: currentMutations,
                    language: lang 
                })
            });
            
            if (!response.ok) {
                throw new Error(`Server error: ${response.status} ${response.statusText}`);
            }
            const contentType = response.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) {
                throw new Error(`Expected JSON but received ${contentType}`);
            }
            
            const data = await response.json();
            
            if(data.explanation && data.truth) {
                document.getElementById('explanationText').innerText = data.explanation;
                document.getElementById('truthText').innerText = data.truth;
            }
            if(data.breakdown) {
                document.getElementById('statSource').innerText = data.breakdown.source_reliability || 'N/A';
                document.getElementById('statConsistency').innerText = data.breakdown.factual_consistency || 'N/A';
                document.getElementById('statFallacy').innerText = data.breakdown.logical_fallacies || 'None';
            }
            if(data.ui_headers) {
                document.getElementById('verdictTitle').innerText = data.ui_headers.verdict || document.getElementById('verdictTitle').innerText;
                document.getElementById('headerWhyFake').innerText = data.ui_headers.why_fake || 'Why is it Fake?';
                document.getElementById('headerTruth').innerText = data.ui_headers.actual_truth || 'The Actual Truth';
                document.getElementById('headerCredibility').innerText = data.ui_headers.credibility || 'Credibility Breakdown';
                document.getElementById('labelSource').innerText = data.ui_headers.source_rel || 'Source Reliability';
                document.getElementById('labelConsistency').innerText = data.ui_headers.factual_con || 'Factual Consistency';
                document.getElementById('labelFallacy').innerText = data.ui_headers.log_fallacies || 'Logical Fallacies';
                document.getElementById('headerSources').innerText = data.ui_headers.live_sources || 'Live Web Sources';
                
                if (document.getElementById('headerVirality')) document.getElementById('headerVirality').innerText = data.ui_headers.virality_velocity || 'Virality Velocity';
                if (document.getElementById('headerOrigin')) document.getElementById('headerOrigin').innerText = data.ui_headers.origin_details || 'Origin Details';
                if (document.getElementById('headerMutations')) document.getElementById('headerMutations').innerText = data.ui_headers.language_mutations || 'Known Mutations';
            }
            if (data.virality && document.getElementById('viralityComment')) {
                document.getElementById('viralityComment').innerText = data.virality.comment || '';
            }
            if (data.origin && document.getElementById('originAge')) {
                document.getElementById('originAge').innerText = data.origin.age || '';
            }
        } catch (e) {
            console.error("Translation failed:", e);
            alert("Translation error: " + e.message);
        } finally {
            translateBtn.classList.remove('hidden');
            translateLoading.classList.add('hidden');
        }
    });

    resetBtn.addEventListener('click', () => {
        resultState.classList.add('hidden');
        searchSection.classList.remove('hidden');
        claimInput.value = '';
        document.getElementById('confidenceBar').style.width = '0%';
        lastSpreadLocations = [];
    });

    // ── PDF Download ────────────────────────────────────────────────────────
    document.getElementById('downloadReportBtn').addEventListener('click', () => {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const margin = 18;
        const contentW = pageW - margin * 2;
        let y = 0;

        // Helpers
        const newPage = () => { doc.addPage(); y = margin; };
        const checkY = (needed = 12) => { if (y + needed > pageH - margin) newPage(); };
        const wrap = (text, maxW) => doc.splitTextToSize(String(text || ''), maxW);

        // ── Cover / Header ──
        doc.setFillColor(3, 7, 18);
        doc.rect(0, 0, pageW, pageH, 'F');

        // Title bar
        doc.setFillColor(30, 58, 138);
        doc.rect(0, 0, pageW, 38, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.text('VERITAS', margin, 18);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(147, 197, 253);
        doc.text('AI-Powered Disinformation Detection Report', margin, 26);
        doc.setTextColor(100, 116, 139);
        doc.setFontSize(8);
        doc.text(`Generated: ${new Date().toLocaleString()}`, margin, 34);

        y = 50;

        // Verdict banner
        const verdictEl = document.getElementById('verdictTitle');
        const verdict = verdictEl ? verdictEl.innerText : 'Unknown';
        const isFake = verdict.toLowerCase().includes('fake') || verdict.toLowerCase().includes('नकली');
        const bannerColor = isFake ? [239, 68, 68] : [16, 185, 129];
        doc.setFillColor(...bannerColor);
        doc.roundedRect(margin, y, contentW, 18, 3, 3, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text(verdict, pageW / 2, y + 11, { align: 'center' });
        y += 24;

        // Confidence
        const conf = document.getElementById('confidenceScore')?.innerText || '';
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(156, 163, 175);
        doc.text(`Confidence Score: ${conf}`, pageW / 2, y, { align: 'center' });
        y += 12;

        // Section helper
        const section = (title, color = [96, 165, 250]) => {
            checkY(14);
            doc.setFillColor(...color);
            doc.rect(margin, y, 3, 8, 'F');
            doc.setTextColor(...color);
            doc.setFontSize(11);
            doc.setFont('helvetica', 'bold');
            doc.text(title, margin + 6, y + 6);
            y += 12;
        };

        const bodyText = (text) => {
            const lines = wrap(text, contentW);
            checkY(lines.length * 5 + 2);
            doc.setFontSize(9.5);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(209, 213, 219);
            doc.text(lines, margin, y);
            y += lines.length * 5 + 4;
        };

        const kvRow = (label, value) => {
            checkY(8);
            doc.setFontSize(9);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(148, 163, 184);
            doc.text(label + ':', margin, y);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(209, 213, 219);
            const val = wrap(String(value || 'N/A'), contentW - 40);
            doc.text(val, margin + 40, y);
            y += val.length * 4.5 + 2;
        };

        // ── Claim ──
        section('Analysed Claim', [96, 165, 250]);
        const claim = document.getElementById('claimInput')?.value || '';
        bodyText(claim);

        // ── Explanation ──
        const explanation = document.getElementById('explanationText')?.innerText || '';
        const headerWhyFake = document.getElementById('headerWhyFake')?.innerText || 'Analysis';
        section(headerWhyFake, [248, 113, 113]);
        bodyText(explanation);

        // ── Truth ──
        const truth = document.getElementById('truthText')?.innerText || '';
        section(document.getElementById('headerTruth')?.innerText || 'The Actual Truth', [52, 211, 153]);
        bodyText(truth);

        // ── Credibility ──
        section(document.getElementById('headerCredibility')?.innerText || 'Credibility Breakdown', [167, 139, 250]);
        kvRow(document.getElementById('labelSource')?.innerText || 'Source Reliability', document.getElementById('statSource')?.innerText);
        kvRow(document.getElementById('labelConsistency')?.innerText || 'Factual Consistency', document.getElementById('statConsistency')?.innerText);
        kvRow(document.getElementById('labelFallacy')?.innerText || 'Logical Fallacies', document.getElementById('statFallacy')?.innerText);
        y += 2;

        // ── Virality ──
        section(document.getElementById('headerVirality')?.innerText || 'Virality Velocity', [245, 158, 11]);
        kvRow('Score', document.getElementById('viralityScore')?.innerText + ' / 10');
        kvRow('Comment', document.getElementById('viralityComment')?.innerText);

        // ── Origin ──
        section(document.getElementById('headerOrigin')?.innerText || 'Origin Details', [59, 130, 246]);
        kvRow('First Seen Platform', document.getElementById('originPlatform')?.innerText);
        kvRow('Age', document.getElementById('originAge')?.innerText);

        // ── Mutations ──
        section(document.getElementById('headerMutations')?.innerText || 'Known Mutations', [236, 72, 153]);
        kvRow('Original', document.getElementById('mutOriginal')?.innerText);
        kvRow('Hindi', document.getElementById('mutHindi')?.innerText);
        kvRow('Bengali', document.getElementById('mutBengali')?.innerText);

        // ── Spread Locations ──
        if (lastSpreadLocations.length) {
            section('India Spread (Google Trends)', [16, 185, 129]);
            lastSpreadLocations.forEach(loc => {
                kvRow(loc.location, `Intensity: ${loc.intensity}  •  Score: ${loc.value}/100`);
            });
        }

        // ── Sources ──
        section('Live Web Sources', [96, 165, 250]);
        const sourceLinks = document.querySelectorAll('#sourcesContainer .source-title');
        if (sourceLinks.length) {
            sourceLinks.forEach((a, i) => {
                checkY(12);
                doc.setFontSize(9);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(96, 165, 250);
                const titleLines = wrap(`${i + 1}. ${a.innerText}`, contentW);
                doc.text(titleLines, margin, y);
                y += titleLines.length * 4.5;
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(100, 116, 139);
                const urlLines = wrap(a.href, contentW);
                doc.text(urlLines, margin + 4, y);
                y += urlLines.length * 4 + 3;
            });
        } else {
            bodyText('No sources found.');
        }

        // ── Footer on every page ──
        const totalPages = doc.internal.getNumberOfPages();
        for (let p = 1; p <= totalPages; p++) {
            doc.setPage(p);
            doc.setFillColor(15, 23, 42);
            doc.rect(0, pageH - 10, pageW, 10, 'F');
            doc.setFontSize(7);
            doc.setTextColor(100, 116, 139);
            doc.text('Veritas | AI-Powered Disinformation Detection', margin, pageH - 4);
            doc.text(`Page ${p} of ${totalPages}`, pageW - margin, pageH - 4, { align: 'right' });
        }

        const filename = `Veritas_Report_${new Date().toISOString().slice(0,10)}.pdf`;
        doc.save(filename);
    });
});

