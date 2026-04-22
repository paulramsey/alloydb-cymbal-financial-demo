import { useState, useEffect, useRef } from 'react'
import './index.css'

const TradingViewWidget = ({ ticker }) => {
  const container = useRef();
  useEffect(() => {
    if (container.current) {
      container.current.innerHTML = '<div class="tradingview-widget-container__widget"></div>';
    }
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      "symbol": ticker,
      "theme": "light",
      "width": "100%",
      "height": "300",
      "locale": "en",
      "interval": "D",
      "timeframe": "1M"
    });
    container.current.appendChild(script);
  }, [ticker]);
  return (
    <div className="tradingview-widget-container" ref={container} style={{ height: '400px' }}>
      <div className="tradingview-widget-container__widget"></div>
    </div>
  );
};

const REVERSE_ETL_SQL = `CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
    'daily_retl_table_refresh', -- Job name
    '0 0 * * *',                -- Every day at midnight (Cron syntax)
    $$-- Refresh company_concepts
    CREATE TABLE IF NOT EXISTS retl_company_concepts_staging AS (SELECT * FROM ext_company_concepts);
    DROP TABLE IF EXISTS retl_company_concepts;
    ALTER TABLE retl_company_concepts_staging RENAME TO retl_company_concepts;

    -- Refresh company_tickers
    CREATE TABLE IF NOT EXISTS retl_company_tickers_staging AS (SELECT * FROM ext_company_tickers);
    DROP TABLE IF EXISTS retl_company_tickers;
    ALTER TABLE retl_company_tickers_staging RENAME TO retl_company_tickers;

    -- Re-create the index
    CREATE INDEX idx_retl_concepts_partial 
    ON public.retl_company_concepts (cik)
    WHERE fy = 2025 AND fp = 'FY';$$
);`;

const BULK_SQL_QUERY = `PREPARE card_testing AS
SELECT id 
FROM transactions_25_26
WHERE ai.if('Is this transaction likely a ''card testing'' attempt, characterized by a low monetary value at an online merchant or automated service, used by fraudsters to verify card validity? Transaction Description: ' || transaction_description, embedding);

EXECUTE card_testing;

PREPARE lifestyle_mismatch AS
SELECT id 
FROM transactions_25_26
WHERE ai.if('Does the transaction amount seem disproportionately large or out of character when compared to the user''s reported yearly income or credit score, suggesting potential account takeover? Transaction Description: ' || transaction_description, embedding);

EXECUTE lifestyle_mismatch;

PREPARE structured_amounts AS
SELECT id 
FROM transactions_25_26
WHERE ai.if('Does the transaction amount exhibit suspicious patterns, such as being a perfectly round number or falling just below common detection thresholds, which might suggest structured fraud or money laundering? Transaction Description: ' || transaction_description, embedding);

EXECUTE structured_amounts;`;

const SEARCH_EXAMPLES = [
  {
    label: "Manufacturing Relocation",
    query: "Geopolitical instability leading to manufacturing relocation",
    filters: { assets: 'high', operating_income: 'high' }
  },
  {
    label: "Inflation & Supply Pressures",
    query: "Raw material inflation, shipping bottlenecks, and cost of goods sold pressures",
    filters: { gross_profit: 'low' }
  },
  {
    label: "Legal & Regulatory Liability",
    query: "Pending legal proceedings, environmental regulations, and compliance penalties",
    filters: { liabilities: 'high', net_income: 'low' }
  },
  {
    label: "M&A and Strategic Expansion",
    query: "Goodwill valuations, corporate acquisitions, and integration of newly acquired tangible assets",
    filters: { assets: 'high', equity: 'medium' }
  },
  {
    label: "Liquidity Crisis & Pivot",
    query: "Credit facility availability, operational restructuring, and pivot to new markets",
    filters: { cash: 'low', revenues: 'high' }
  },
  {
    label: "Labor & Overhead Challenges",
    query: "Labor shortages, union negotiations, wage inflation, and SG&A overhead expenditures",
    filters: { operating_income: 'low' }
  }
];

function App() {
  const [activeTab, setActiveTab] = useState('search')
  const [searchQuery, setSearchQuery] = useState('')
  const [showOptions, setShowOptions] = useState(false)
  
  // Load Generator States
  const [loadRunning, setLoadRunning] = useState(false)
  const [tqfEnabled, setTqfEnabled] = useState(false)
  const [primaryLoad, setPrimaryLoad] = useState(5)
  const [poolLoad, setPoolLoad] = useState(2)
  const [concurrentWrites, setConcurrentWrites] = useState(0)
  const [concurrentReads, setConcurrentReads] = useState(0)
  const [readsForwarded, setReadsForwarded] = useState(0)
  const [disqualifiedReads, setDisqualifiedReads] = useState(0)
  const [primaryConnections, setPrimaryConnections] = useState(0)
  const [primaryCPU, setPrimaryCPU] = useState(0)
  const [poolConnections, setPoolConnections] = useState(0)
  const [poolCPU, setPoolCPU] = useState(0)
  const [lastReadQuery, setLastReadQuery] = useState('')
  const [lastWriteQuery, setLastWriteQuery] = useState('')
  const prevStatsRef = useRef({ local: 0, forwarded: 0 })

  // Lakehouse States
  const [selectedScenario, setSelectedScenario] = useState('sector')

  // Search Mode States
  const [searchMode, setSearchMode] = useState('fulltext')

  // Fraud Detection States
  const [fraudData, setFraudData] = useState(null)
  const [loadingFraud, setLoadingFraud] = useState(false)
  const [clientId, setClientId] = useState(0)
  const [transactionId, setTransactionId] = useState('10763569')
  const [selectedThreshold, setSelectedThreshold] = useState(0.021)
  const [aiIfEnabled, setAiIfEnabled] = useState(false)
  const [aiIfResults, setAiIfResults] = useState(null)
  const [loadingAiIf, setLoadingAiIf] = useState(false)
  const [showFraudCurrentSql, setShowFraudCurrentSql] = useState(false)
  const [showFraudHistorySql, setShowFraudHistorySql] = useState(false)
  const [streamingTransactions, setStreamingTransactions] = useState([])
  const [isStreaming, setIsStreaming] = useState(true)
  const [clickedDate, setClickedDate] = useState(null)
  const [forceAiIf, setForceAiIf] = useState(false)
  const [showFraudEnhanceSql, setShowFraudEnhanceSql] = useState(false)
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [showDrawer, setShowDrawer] = useState(false)
  const [currentSql, setCurrentSql] = useState('')
  const [vectorIndex, setVectorIndex] = useState('scann')
  const [explainPlan, setExplainPlan] = useState('')
  const [explaining, setExplaining] = useState(false)
  const [isAiIfDrawer, setIsAiIfDrawer] = useState(false)
  const [drawerTab, setDrawerTab] = useState('array')
  const [showModal, setShowModal] = useState(false)
  const [modalContent, setModalContent] = useState({ summary: '', explanation: '', sql: '' })
  const [showTickerModal, setShowTickerModal] = useState(false)
  const [showLakehouseDetailsModal, setShowLakehouseDetailsModal] = useState(false)
  const [lakehouseDetailsData, setLakehouseDetailsData] = useState(null)
  const [loadingLakehouseDetails, setLoadingLakehouseDetails] = useState(false)
  const [activeTicker, setActiveTicker] = useState('')
  const [tickerExposure, setTickerExposure] = useState([])
  const [hasMapping, setHasMapping] = useState(false)
  const [loadingExposure, setLoadingExposure] = useState(false)
  const [loadingModal, setLoadingModal] = useState(false)
  const [showModalSql, setShowModalSql] = useState(false)
  const [drawerWidth, setDrawerWidth] = useState(600)
  const [isResizing, setIsResizing] = useState(false)
  const [companyOverview, setCompanyOverview] = useState(null)
  const [loadingOverview, setLoadingOverview] = useState(false)
  const [showManualInputs, setShowManualInputs] = useState(false)
  const [showExamples, setShowExamples] = useState(false)
  const [showFraudPromptModal, setShowFraudPromptModal] = useState(false)
  const [fraudPromptContent, setFraudPromptContent] = useState({ title: '', prompt: '' })

  const showDrawerRef = useRef(showDrawer)
  useEffect(() => {
    showDrawerRef.current = showDrawer
    if (!showDrawer) {
      setExplainPlan('')
      setIsAiIfDrawer(false)
      setDrawerTab('array')
    }
  }, [showDrawer])

  useEffect(() => {
    let intervalId;
    if (activeTab === 'fraud' && isStreaming) {
      fetch('/api/fraud-stream')
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data) && data.length > 0) {
             const initial = data.slice(0, 5).reverse();
             setStreamingTransactions(initial);
             let currentIndex = 5;
             intervalId = setInterval(() => {
                if (currentIndex < data.length) {
                   setStreamingTransactions(prev => [data[currentIndex], ...prev].slice(0, 50));
                   currentIndex++;
                } else {
                   clearInterval(intervalId);
                }
             }, 2000);
          }
        })
        .catch(err => console.error("Error fetching stream:", err));
    }
    
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [activeTab, isStreaming]);

  const isCombinedFraud = (fraudData && fraudData.avg_distance > selectedThreshold) || 
                          (aiIfResults && (aiIfResults.Q1 === 'Yes' || aiIfResults.Q2 === 'Yes' || aiIfResults.Q3 === 'Yes' || aiIfResults.Q4 === 'Yes'));
  const [isEnhanced, setIsEnhanced] = useState(false)
  const [showOverviewSql, setShowOverviewSql] = useState(false)
  const [showHoldingsSql, setShowHoldingsSql] = useState(false)
  const [ftsIndex, setFtsIndex] = useState('rum')
  const [reranker, setReranker] = useState('vertex')
  const [hasSearched, setHasSearched] = useState(false)
  
  // Lakehouse Federation States
  const [lakehouseQuery, setLakehouseQuery] = useState('')
  const [lakehouseResults, setLakehouseResults] = useState([])
  const [loadingLakehouse, setLoadingLakehouse] = useState(false)
  const [lakehouseSql, setLakehouseSql] = useState('')
  const [lakehouseTab, setLakehouseTab] = useState('advanced')
  const [useReverseEtl, setUseReverseEtl] = useState(false)
  const [lakehouseDrawerTab, setLakehouseDrawerTab] = useState('lakehouse')
  const [advancedModalText, setAdvancedModalText] = useState(null)
  const [vectorQuery, setVectorQuery] = useState('')
  const [filters, setFilters] = useState({
    assets: 'none',
    liabilities: 'none',
    equity: 'none',
    cash: 'none',
    revenues: 'none',
    net_income: 'none',
    operating_income: 'none',
    gross_profit: 'none'
  })
  const [expandedItem, setExpandedItem] = useState(null)
  const [showAllLakehouseFilters, setShowAllLakehouseFilters] = useState(false)

  const handleLakehouseSearch = async (overrideTicker = null) => {
    setLoadingLakehouse(true)
    const tickerToSearch = (typeof overrideTicker === 'string' ? overrideTicker : null) || lakehouseQuery;
    try {
      const response = await fetch(`/api/lakehouse-search?ticker=${encodeURIComponent(tickerToSearch)}`)
      const data = await response.json()
      setLakehouseResults(data.results || [])
      setLakehouseSql(data.sql || '')
      setCurrentSql(data.sql || '')
    } catch (error) {
      console.error('Lakehouse search error:', error)
      setLakehouseResults([])
    } finally {
      setLoadingLakehouse(false)
    }
  }

  const handleAdvancedSearch = async () => {
    setLoadingLakehouse(true)
    try {
      let url = `/api/lakehouse-advanced-search?query=${encodeURIComponent(vectorQuery)}`
      if (useReverseEtl) {
        url += `&use_reverse_etl=true`
      }
      Object.keys(filters).forEach(key => {
        if (filters[key] !== 'none') {
          url += `&${key}=${filters[key]}`
        }
      })
      const res = await fetch(url)
      const data = await res.json()
      setLakehouseResults(data.results || [])
      setLakehouseSql(data.sql || '')
      setCurrentSql(data.sql || '')
    } catch (error) {
      console.error('Lakehouse advanced search error:', error)
      setLakehouseResults([])
    } finally {
      setLoadingLakehouse(false)
    }
  }

  const handleSearch = async () => {
    setLoading(true)
    setExplainPlan('')
    try {
      const response = await fetch(`/api/search?query=${encodeURIComponent(searchQuery)}&mode=${searchMode}&vectorIndex=${vectorIndex}&ftsIndex=${ftsIndex}&reranker=${reranker}`)
      const data = await response.json()
      console.log('Results from API:', data.results)
      setResults(data.results || [])
      setCurrentSql(data.sql || 'No SQL returned')
      setHasSearched(true)
    } catch (error) {
      console.error('Search error:', error)
      setResults([{ id: 'error', ticker: 'ERROR', text: 'Failed to fetch results from backend.', type: 'System', score: 0 }])
    } finally {
      setLoading(false)
    }
  }

  const handleExplain = async () => {
    setExplaining(true)
    setExplainPlan('')
    try {
      let response;
      if (activeTab === 'lakehouse') {
        response = await fetch(`/api/lakehouse-search?ticker=${encodeURIComponent(lakehouseQuery)}&explain=true`)
      } else {
        response = await fetch(`/api/search?query=${encodeURIComponent(searchQuery)}&mode=${searchMode}&vectorIndex=${vectorIndex}&ftsIndex=${ftsIndex}&reranker=${reranker}&explain=true`)
      }
      const data = await response.json()
      if (showDrawerRef.current) {
        setExplainPlan(data.explain_plan || 'No plan returned')
      }
    } catch (error) {
      console.error('Explain error:', error)
      if (showDrawerRef.current) {
        setExplainPlan('Failed to fetch explain plan from backend.')
      }
    } finally {
      setExplaining(false)
    }
  }

  const handleAnalyzeChunk = async (result) => {
    setShowModal(true)
    setLoadingModal(true)
    setShowModalSql(false)
    setModalContent({ summary: '', explanation: '', sql: '' })
    try {
      const currentQuery = result.query !== undefined ? result.query : searchQuery;
      const response = await fetch(`/api/analyze-chunk?ticker=${result.ticker}&chunk_index=${result.chunk_index}&query=${encodeURIComponent(currentQuery)}`)
      const data = await response.json()
      if (data.error) {
        setModalContent({ summary: 'Error', explanation: data.error, sql: '' })
      } else {
        setModalContent({ summary: data.summary, explanation: data.explanation, sql: data.sql })
      }
    } catch (error) {
      console.error('Analyze chunk error:', error)
      setModalContent({ summary: 'Error', explanation: 'Failed to fetch analysis from backend.', sql: '' })
    } finally {
      setLoadingModal(false)
    }
  }

  const fetchTickerExposure = async (ticker) => {
    setLoadingExposure(true)
    try {
      const response = await fetch(`/api/ticker-exposure?ticker=${ticker}`)
      const data = await response.json()
      setTickerExposure(data.results || [])
      setHasMapping(data.has_mapping || false)
    } catch (error) {
      console.error('Fetch ticker exposure error:', error)
      setTickerExposure([])
    } finally {
      setLoadingExposure(false)
    }
  }

  const handleDateClick = async (ticker, date) => {
    setLoadingLakehouseDetails(true)
    setActiveTicker(ticker)
    setShowLakehouseDetailsModal(true)
    try {
      const response = await fetch(`/api/lakehouse-ticker-details?ticker=${ticker}&date=${date}`)
      const data = await response.json()
      setLakehouseDetailsData(data)
    } catch (error) {
      console.error('Fetch ticker details error:', error)
      setLakehouseDetailsData(null)
    } finally {
      setLoadingLakehouseDetails(false)
    }
  }

  const fetchFraudDetection = async (cId = 0, tId = '') => {
    setLoadingFraud(true)
    setForceAiIf(false)
    try {
      let url = `/api/fraud-detection?client_id=${cId}`
      if (tId) {
        url += `&transaction_id=${tId}`
      }
      const response = await fetch(url)
      const data = await response.json()
      setFraudData(data)
    } catch (error) {
      console.error('Fetch fraud detection error:', error)
      setFraudData(null)
    } finally {
      setLoadingFraud(false)
    }
  }

  const fetchFraudEnhance = async (tId) => {
    setLoadingAiIf(true)
    setAiIfResults(null) // Reset previous results
    try {
      const response = await fetch(`/api/fraud-enhance?transaction_id=${tId}`)
      const data = await response.json()
      setAiIfResults(data)
    } catch (error) {
      console.error('Error fetching fraud enhance:', error)
      setAiIfResults({ error: String(error) })
    } finally {
      setLoadingAiIf(false)
    }
  }

  const fetchCompanyOverview = async (ticker) => {
    setLoadingOverview(true)
    setCompanyOverview(null)
    try {
      const response = await fetch(`/api/company-overview?ticker=${ticker}`)
      const data = await response.json()
      if (data.error) {
        setCompanyOverview({ error: data.error })
      } else {
        setCompanyOverview(data)
      }
    } catch (error) {
      console.error('Fetch company overview error:', error)
      setCompanyOverview({ error: 'Failed to fetch company overview.' })
    } finally {
      setLoadingOverview(false)
    }
  }

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing) return
      const newWidth = window.innerWidth - e.clientX
      if (newWidth > 300 && newWidth < window.innerWidth * 0.8) {
        setDrawerWidth(newWidth)
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing])



  useEffect(() => {
    if (activeTab === 'fraud' && aiIfEnabled && fraudData && fraudData.current_transaction) {
      const avgDist = fraudData.avg_distance;
      const threshold = selectedThreshold;
      if (forceAiIf || Math.abs(avgDist - threshold) <= 0.007) {
        fetchFraudEnhance(fraudData.current_transaction.id);
      } else {
        setAiIfResults({ skipped: true, message: 'AI check skipped: Vector search highly confident.' });
      }
    }
  }, [activeTab, aiIfEnabled, fraudData, selectedThreshold, forceAiIf])


  // Poll TQF stats from backend when load is running
  useEffect(() => {
    let interval;
    if (loadRunning) {
      interval = setInterval(async () => {
        try {
          const response = await fetch('/api/tqf/stats')
          const data = await response.json()
          
          setConcurrentReads((data.total_reads || 0) * 88)
          setConcurrentWrites((data.total_writes || 0) * 88)
          setPrimaryConnections(data.total_connections || 0)
          setPrimaryCPU((data.active_connections || 0) * 88)
          setLastReadQuery(data.last_read_query || '')
          setLastWriteQuery(data.last_write_query || '')
          
            const totalReads = data.total_reads || 0;
            const totalWrites = data.total_writes || 0;
            const stats = (data.stats && data.stats.length > 0) ? data.stats[0] : {};
            const dbForwarded = stats.num_completed || 0;
            const disqualified = stats.num_disqualified || 0;
            
            setReadsForwarded(dbForwarded * 88)
            setDisqualifiedReads(disqualified * 88)
            
            // Cap forwarded reads at total reads to prevent negative percentages
            const forwarded = Math.min(totalReads, dbForwarded);
            
            const local = totalWrites + (totalReads - forwarded);
            const total = local + forwarded;
            
            if (total > 0) {
              setPrimaryLoad((local / total) * 100);
              setPoolLoad((forwarded / total) * 100);
            } else {
              setPrimaryLoad(5);
              setPoolLoad(0);
            }
            
            // Simulate pool metrics if TQF is enabled and active
            if (tqfEnabled && forwarded > 0) {
              setPoolConnections(Math.min(data.total_connections, 10))
              setPoolCPU(Math.min(data.active_connections, 8) * 88)
            } else {
              setPoolConnections(1)
              setPoolCPU(0)
            }
        } catch (error) {
          console.error('Fetch TQF stats error:', error)
        }
      }, 1000);
    }

    return () => clearInterval(interval);
  }, [loadRunning, tqfEnabled]);

  return (
    <>
      <div style={{ 
        background: 'rgba(32, 33, 36, 0.95)', /* Dark glassmorphism */
        backdropFilter: 'blur(10px)',
        color: '#fff', 
        padding: '0.6rem 1rem', 
        fontSize: '0.925rem',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '0.6rem',
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        zIndex: 1500,
        boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
      }}>
        <span>powered by</span>
        <img src="/alloydb-logo.png" alt="AlloyDB" style={{ width: '26px', height: '26px' }} />
        <span style={{ fontWeight: 'bold' }}>AlloyDB</span>
      </div>

      <div className="search-container" style={{ marginTop: '60px' }}>
        <header className="search-header">
        <h1>Cymbal Financial</h1>
        <p>
          {activeTab === 'search' && "SEC 10-K & 13F Hybrid Search Intelligence"}
          {activeTab === 'tqf' && "Automatic Read Forwarding Without Changing Endpoints"}
          {activeTab === 'fraud' && "Vector-Powered Fraud Detection with AI.IF() Refinement"}
          {activeTab === 'lakehouse' && "Query Lakehouse Data from AlloyDB"}
        </p>
      </header>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', justifyContent: 'center' }}>
        <button 
          style={{ background: activeTab === 'search' ? 'var(--cymbal-green)' : 'rgba(0,0,0,0.05)', color: activeTab === 'search' ? 'white' : 'var(--text-primary)' }}
          onClick={() => setActiveTab('search')}
        >
          Hybrid Search
        </button>
        <button 
          style={{ background: activeTab === 'tqf' ? 'var(--cymbal-green)' : 'rgba(0,0,0,0.05)', color: activeTab === 'tqf' ? 'white' : 'var(--text-primary)' }}
          onClick={() => setActiveTab('tqf')}
        >
          Transparent Query Forwarding
        </button>
        <button 
          style={{ background: activeTab === 'fraud' ? 'var(--cymbal-green)' : 'rgba(0,0,0,0.05)', color: activeTab === 'fraud' ? 'white' : 'var(--text-primary)' }}
          onClick={() => setActiveTab('fraud')}
        >
          Fraud Detection
        </button>
        <button 
          style={{ background: activeTab === 'lakehouse' ? 'var(--cymbal-green)' : 'rgba(0,0,0,0.05)', color: activeTab === 'lakehouse' ? 'white' : 'var(--text-primary)' }}
          onClick={() => setActiveTab('lakehouse')}
        >
          Lakehouse Federation
        </button>
      </div>

      {activeTab === 'search' ? (
        <>
          <div className="search-box-wrapper glass">
            <div style={{ padding: '1.5rem' }}>
              <div style={{ 
                display: 'flex', 
                alignItems: 'stretch', 
                border: '1px solid var(--border-color)', 
                borderRadius: '24px', 
                overflow: 'hidden', 
                background: 'white',
                boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                height: '48px'
              }}>
                <select 
                  style={{ 
                    background: 'rgba(0,0,0,0.02)', 
                    color: 'var(--text-primary)', 
                    padding: '0 1rem', 
                    border: 'none', 
                    borderRight: '1px solid var(--border-color)',
                    outline: 'none',
                    cursor: 'pointer',
                    borderRadius: '24px 0 0 24px',
                    fontWeight: 'bold'
                  }}
                  value={searchMode}
                  onChange={(e) => setSearchMode(e.target.value)}
                >
                  <option value="hybrid">Hybrid</option>
                  <option value="fulltext">Full-text</option>
                  <option value="vector">Vector</option>
                </select>
                <input 
                  type="text" 
                  placeholder="Search filings, financial summaries, or investment holdings..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSearch();
                    }
                  }}
                  style={{ 
                    border: 'none', 
                    outline: 'none', 
                    padding: '0 1rem', 
                    flex: 1,
                    fontSize: '1rem'
                  }}
                />
                <button 
                  onClick={() => setShowDrawer(!showDrawer)}
                  style={{ 
                    background: 'none', 
                    border: 'none', 
                    cursor: 'pointer', 
                    padding: '0 0.75rem', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    color: 'var(--text-secondary)'
                  }}
                  title="Show SQL"
                >
                  <span style={{ fontSize: '0.875rem', fontWeight: 'bold', fontFamily: 'monospace' }}>SQL</span>
                </button>
                <button 
                  onClick={() => setShowOptions(!showOptions)}
                  style={{ 
                    background: 'none', 
                    border: 'none', 
                    cursor: 'pointer', 
                    padding: '0 0.75rem', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    color: 'var(--text-secondary)'
                  }}
                  title="Options"
                >
                  <span style={{ fontSize: '1.25rem' }}>⚙️</span>
                </button>
                <button 
                  onClick={handleSearch}
                  style={{ 
                    borderRadius: '0 24px 24px 0', 
                    padding: '0 1.5rem', 
                    border: 'none', 
                    background: 'var(--cymbal-green)', 
                    color: 'white', 
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  Search
                </button>
              </div>
            </div>

            {showOptions && (
              <div style={{ 
                padding: '1.5rem', 
                borderTop: '1px solid var(--border-color)',
                display: 'flex',
                gap: '2rem',
                flexWrap: 'wrap'
              }}>
                {searchMode !== 'fulltext' && (
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Vector Index</label>
                    <select 
                      style={{ background: 'white', color: 'var(--text-primary)', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                      value={vectorIndex}
                      onChange={(e) => setVectorIndex(e.target.value)}
                    >
                      <option value="scann">ScaNN (Tree Quantization)</option>
                      <option value="hnsw">HNSW (Graph-based)</option>
                    </select>
                  </div>
                )}
                {searchMode !== 'vector' && (
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Full-Text Index</label>
                    <select 
                      style={{ background: 'white', color: 'var(--text-primary)', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                      value={ftsIndex}
                      onChange={(e) => setFtsIndex(e.target.value)}
                    >
                      <option value="rum">RUM</option>
                      <option value="gin">Native GIN</option>
                      <option value="bm25" disabled>BM25 (Coming Soon)</option>
                    </select>
                  </div>
                )}
                {searchMode === 'hybrid' && (
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Reranker</label>
                    <select 
                      style={{ background: 'white', color: 'var(--text-primary)', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                      value={reranker}
                      onChange={(e) => setReranker(e.target.value)}
                    >
                      <option value="vertex">Vertex AI (semantic-ranker-512)</option>
                      <option value="rrf">Reciprocal Rank Fusion (RRF)</option>
                      <option value="none">None</option>
                    </select>
                  </div>
                )}

              </div>
            )}
          </div>

          <div className="glass" style={{ padding: '1.5rem', overflowX: 'auto' }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '2rem' }}>
                Loading results from AlloyDB...
              </div>
            ) : !hasSearched ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                Enter a query and click Search to see results.
              </div>
            ) : results.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem' }}>
                No results found. Try running a search!
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--text-secondary)' }}>
                    <th style={{ padding: '0.75rem' }}>Score</th>
                    <th style={{ padding: '0.75rem' }}>Ticker</th>
                    <th style={{ padding: '0.75rem' }}>Type</th>
                    {searchMode === 'hybrid' && <th style={{ padding: '0.75rem' }}>Method</th>}
                    <th style={{ padding: '0.75rem' }}>Chunk</th>
                    <th style={{ padding: '0.75rem' }}>Chunk Text</th>
                    <th style={{ padding: '0.75rem' }}>Explain</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map(result => (
                    <tr key={result.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                      <td style={{ padding: '0.75rem', fontWeight: 'bold', color: 'var(--cymbal-green)' }}>{result.score}</td>
                      <td style={{ padding: '0.75rem' }}>
                        <a 
                          href={`https://www.google.com/search?q=${result.ticker}+stock`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => {
                            e.preventDefault();
                            setActiveTicker(result.ticker);
                            setShowTickerModal(true);
                            if (activeTab === 'lakehouse') {
                              setIsEnhanced(true);
                              fetchCompanyOverview(result.ticker);
                              fetchTickerExposure(result.ticker);
                            } else {
                              setIsEnhanced(false);
                            }
                          }}
                          style={{ color: 'var(--cymbal-green)', textDecoration: 'underline', cursor: 'pointer' }}
                        >
                          {result.ticker}
                        </a>
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        {result.accession_number ? (
                          <a 
                            href={`https://www.sec.gov/edgar/search/#/q=${result.accession_number}`} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            style={{ textDecoration: 'none' }}
                          >
                            <span 
                              className={`badge badge-${result.type.toLowerCase().replace(' ', '-')}`}
                              style={result.type.toLowerCase().includes('10-k') ? { color: 'var(--cymbal-green)' } : {}}
                            >
                              {result.type}
                            </span>
                          </a>
                        ) : (
                          <span 
                            className={`badge badge-${result.type.toLowerCase().replace(' ', '-')}`}
                            style={result.type.toLowerCase().includes('10-k') ? { color: 'var(--cymbal-green)' } : {}}
                          >
                            {result.type}
                          </span>
                        )}
                      </td>
                      {searchMode === 'hybrid' && (
                        <td style={{ padding: '0.75rem' }}>
                          {result.retrieval_method ? (
                            <span style={{ background: 'var(--border-color)', color: 'var(--text-primary)', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>
                              {result.retrieval_method}
                            </span>
                          ) : 'N/A'}
                        </td>
                      )}
                      <td style={{ padding: '0.75rem' }}>{result.chunk_index !== undefined ? result.chunk_index : 'N/A'}</td>
                      <td className="expandable-cell" style={{ padding: '0.75rem', fontSize: '0.875rem', maxWidth: '400px' }}>
                        <details>
                          <summary style={{ outline: 'none' }}>
                            {result.text ? result.text.slice(0, 60) : 'No text'}...
                          </summary>
                          <div style={{ whiteSpace: 'pre-wrap', marginTop: '0.5rem', background: 'rgba(0,0,0,0.02)', padding: '0.5rem', borderRadius: '4px' }}>
                            {result.text}
                          </div>
                        </details>
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                        <button 
                          onClick={() => handleAnalyzeChunk(result)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          title="Analyze with Gemini"
                        >
                          <img src="/gemini-logo.png" alt="Gemini" style={{ width: '24px', height: '24px' }} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : activeTab === 'tqf' ? (
        <div className="glass" style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <h2>Transparent Query Forwarding (TQF)</h2>
            <p>Run trading load and observe AlloyDB automatic read forwarding.</p>
          </div>

          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginBottom: '2rem' }}>
            <button onClick={async () => {
              const action = loadRunning ? 'stop' : 'start';
              await fetch(`/api/tqf/${action}-load`);
              setLoadRunning(!loadRunning);
            }}>
              {loadRunning ? 'Stop Load' : 'Start Load'}
            </button>
            <button 
              style={{ background: tqfEnabled ? 'var(--cymbal-green)' : 'rgba(0,0,0,0.05)', color: tqfEnabled ? 'white' : 'var(--text-primary)' }}
              onClick={async () => {
                const newState = !tqfEnabled;
                await fetch(`/api/tqf/toggle?enabled=${newState}`);
                setTqfEnabled(newState);
              }}
            >
              {tqfEnabled ? 'TQF Enabled' : 'TQF Disabled'}
            </button>
            <button 
              style={{ background: 'rgba(0,0,0,0.05)', color: 'var(--text-primary)' }}
              onClick={async () => {
                await fetch('/api/tqf/reset');
                setConcurrentReads(0);
                setConcurrentWrites(0);
                setReadsForwarded(0);
                setDisqualifiedReads(0);
                setPrimaryLoad(0);
                setPoolLoad(0);
                setTqfEnabled(false);
              }}
            >
              Reset Metrics
            </button>
          </div>

          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginBottom: '2rem' }}>
            <div style={{ background: 'white', padding: '1rem 1.5rem', borderRadius: '1rem', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', textAlign: 'center', minWidth: '150px' }}>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Cumulative Writes</div>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{concurrentWrites}</div>
            </div>
            <div style={{ background: 'white', padding: '1rem 1.5rem', borderRadius: '1rem', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', textAlign: 'center', minWidth: '150px' }}>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Cumulative Reads</div>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{concurrentReads}</div>
            </div>
            <div style={{ background: 'white', padding: '1rem 1.5rem', borderRadius: '1rem', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', textAlign: 'center', minWidth: '150px' }}>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Local Reads</div>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{Math.max(0, concurrentReads - readsForwarded)}</div>
            </div>
            <div style={{ background: 'white', padding: '1rem 1.5rem', borderRadius: '1rem', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', textAlign: 'center', minWidth: '150px' }}>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Reads Forwarded</div>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{readsForwarded}</div>
            </div>


          </div>

          <div style={{ display: 'flex', gap: '2rem', justifyContent: 'space-between' }}>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <h3>Primary Instance</h3>
              <p>(Writes + Non-forwarded Reads)</p>
              <div style={{ padding: '0.5rem', fontSize: '0.9rem' }}>
                <div>Connections: {primaryConnections}</div>
                <div>Active Queries: {primaryCPU}</div>
              </div>
              <div style={{ 
                height: '200px', 
                background: 'rgba(0,0,0,0.05)', 
                borderRadius: '8px', 
                position: 'relative',
                overflow: 'hidden',
                marginTop: '1rem'
              }}>
                <div style={{ 
                  height: `${primaryLoad}%`, 
                  background: 'var(--cymbal-green)', 
                  width: '100%', 
                  position: 'absolute', 
                  bottom: 0,
                  transition: 'height 0.5s ease'
                }}></div>
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontWeight: 'bold' }}>
                  {Math.round(primaryLoad)}%
                </div>
              </div>
              <code style={{ display: 'block', background: 'rgba(0,0,0,0.05)', padding: '0.5rem', borderRadius: '4px', marginTop: '1rem', fontSize: '0.8rem', textAlign: 'left', whiteSpace: 'pre-wrap' }}>
                {lastWriteQuery || 'No query running'}
              </code>
            </div>

            <div style={{ flex: 1, textAlign: 'center' }}>
              <h3>Read Pool</h3>
              <p>(Forwarded Reads)</p>
              <div style={{ padding: '0.5rem', fontSize: '0.9rem' }}>
                <div>Connections: {poolConnections}</div>
                <div>Active Queries: {poolCPU}</div>
              </div>
              <div style={{ 
                height: '200px', 
                background: 'rgba(0,0,0,0.05)', 
                borderRadius: '8px', 
                position: 'relative',
                overflow: 'hidden',
                marginTop: '1rem'
              }}>
                <div style={{ 
                  height: `${poolLoad}%`, 
                  background: 'var(--cymbal-green)', 
                  width: '100%', 
                  position: 'absolute', 
                  bottom: 0,
                  transition: 'height 0.5s ease'
                }}></div>
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontWeight: 'bold' }}>
                  {Math.round(poolLoad)}%
                </div>
              </div>
              <code style={{ display: 'block', background: 'rgba(0,0,0,0.05)', padding: '0.5rem', borderRadius: '4px', marginTop: '1rem', fontSize: '0.8rem', textAlign: 'left', whiteSpace: 'pre-wrap' }}>
                {lastReadQuery || 'No query running'}
              </code>
            </div>
          </div>
          
          <details style={{ marginTop: '2rem', borderTop: '1px solid rgba(0,0,0,0.1)', paddingTop: '1rem' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: 'var(--text-secondary)' }}>
              Behind the Scenes: Configuration
            </summary>
            <div style={{ marginTop: '1rem', fontSize: '0.9rem', textAlign: 'left' }}>
              <p><strong>Connection String:</strong></p>
              <code style={{ display: 'block', background: 'rgba(0,0,0,0.05)', padding: '0.5rem', borderRadius: '4px', marginBottom: '0.5rem' }}>
                {'postgresql://postgres:<password>@<primary-ip>:5432/postgres'}
              </code>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                Notice that the connection string points to the <strong>Primary</strong> instance. It does not change when TQF is enabled!
              </p>
              
              <p><strong>Session Settings:</strong></p>
              <code style={{ display: 'block', background: 'rgba(0,0,0,0.05)', padding: '0.5rem', borderRadius: '4px' }}>
                SET alloydb.query_forwarding_startup_cost = 0.0;<br/>
                SET alloydb.enable_query_forwarding = {tqfEnabled ? 'ON' : 'OFF'};
              </code>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                AlloyDB automatically routes eligible read queries to the read pool based on these session-level parameters.
              </p>
            </div>
          </details>
        </div>
      ) : activeTab === 'fraud' ? (
        <div className="glass" style={{ padding: '2rem', width: '100%', maxWidth: '1000px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <h2>Vector-Based Fraud Detection</h2>
            <p>Comparing transaction vectors to detect anomalies in purchasing habits.</p>
          </div>

          {!isStreaming && (
            <div className="glass" style={{ padding: '1.25rem', marginBottom: '1.5rem', borderRadius: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Top Row: Controls */}
              <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-end' }}>
                {/* Control 1: Input Mode */}
                <div style={{ flex: 1, position: 'relative' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Input Mode</div>
                  <div style={{ display: 'flex', width: '100%', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                    <button
                      onClick={() => setShowManualInputs(false)}
                      style={{
                        flex: 1,
                        padding: '0.5rem',
                        background: !showManualInputs ? 'var(--cymbal-green)' : 'transparent',
                        color: !showManualInputs ? 'white' : 'var(--text-primary)',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                        fontWeight: !showManualInputs ? 'bold' : 'normal',
                        whiteSpace: 'nowrap'
                      }}
                    >Use Example</button>
                    <button
                      onClick={() => setShowManualInputs(true)}
                      style={{
                        flex: 1,
                        padding: '0.5rem',
                        background: showManualInputs ? 'var(--cymbal-green)' : 'transparent',
                        color: showManualInputs ? 'white' : 'var(--text-primary)',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                        fontWeight: showManualInputs ? 'bold' : 'normal',
                        borderLeft: '1px solid var(--border-color)',
                        whiteSpace: 'nowrap'
                      }}
                    >Manual Entry</button>
                  </div>
                  {!showManualInputs && (
                    <div 
                      onClick={() => setShowExamples(!showExamples)} 
                      style={{ 
                        fontSize: '0.75rem', 
                        color: 'var(--cymbal-green)', 
                        cursor: 'pointer', 
                        textDecoration: 'underline',
                        width: '50%',
                        textAlign: 'center',
                        position: 'absolute',
                        top: '102%', // Position just below the button
                        left: 0
                      }}
                    >
                      {showExamples ? 'Hide Examples' : 'Select Example'}
                    </div>
                  )}
                </div>

                {/* Control 2: Vector Distance Threshold */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Vector Distance Threshold</div>
                  <div style={{ display: 'flex', width: '100%', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                    <button
                      onClick={() => setSelectedThreshold(0.011)}
                      style={{
                        flex: 1,
                        padding: '0.5rem',
                        background: selectedThreshold === 0.011 ? 'var(--cymbal-green)' : 'transparent',
                        color: selectedThreshold === 0.011 ? 'white' : 'var(--text-primary)',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                        fontWeight: selectedThreshold === 0.011 ? 'bold' : 'normal'
                      }}
                    >
                      0.011
                    </button>
                    <button
                      onClick={() => setSelectedThreshold(0.021)}
                      style={{
                        flex: 1,
                        padding: '0.5rem',
                        background: selectedThreshold === 0.021 ? 'var(--cymbal-green)' : 'transparent',
                        color: selectedThreshold === 0.021 ? 'white' : 'var(--text-primary)',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                        fontWeight: selectedThreshold === 0.021 ? 'bold' : 'normal',
                        borderLeft: '1px solid var(--border-color)'
                      }}
                    >
                      0.021
                    </button>
                    <button
                      onClick={() => setSelectedThreshold(0.031)}
                      style={{
                        flex: 1,
                        padding: '0.5rem',
                        background: selectedThreshold === 0.031 ? 'var(--cymbal-green)' : 'transparent',
                        color: selectedThreshold === 0.031 ? 'white' : 'var(--text-primary)',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                        fontWeight: selectedThreshold === 0.031 ? 'bold' : 'normal',
                        borderLeft: '1px solid var(--border-color)'
                      }}
                    >
                      0.031
                    </button>
                  </div>
                </div>

                {/* Control 3: AI.IF Analysis */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>AI.IF Analysis</div>
                  <div style={{ display: 'flex', width: '100%', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                    <button
                      onClick={() => setAiIfEnabled(true)}
                      style={{
                        flex: 1,
                        padding: '0.5rem',
                        background: aiIfEnabled ? 'var(--cymbal-green)' : 'transparent',
                        color: aiIfEnabled ? 'white' : 'var(--text-primary)',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                        fontWeight: aiIfEnabled ? 'bold' : 'normal'
                      }}
                    >
                      Enabled
                    </button>
                    <button
                      onClick={() => setAiIfEnabled(false)}
                      style={{
                        flex: 1,
                        padding: '0.5rem',
                        background: !aiIfEnabled ? 'var(--cymbal-green)' : 'transparent',
                        color: !aiIfEnabled ? 'white' : 'var(--text-primary)',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                        fontWeight: !aiIfEnabled ? 'bold' : 'normal',
                        borderLeft: '1px solid var(--border-color)'
                      }}
                    >
                      Disabled
                    </button>
                  </div>
                </div>

              </div>



              {/* Bottom Row: Context */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3rem', marginTop: '1rem' }}>
                {/* Left Column: Examples / Manual Inputs */}
                <div>
                  {showManualInputs ? (
                    <div style={{ display: 'flex', gap: '1rem' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Client ID</div>
                        <input 
                          type="number" 
                          value={clientId} 
                          onChange={(e) => setClientId(parseInt(e.target.value) || 0)}
                          style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                        />
                      </div>
                      <div style={{ flex: 2 }}>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Transaction ID</div>
                        <input 
                          type="text" 
                          value={transactionId} 
                          onChange={(e) => setTransactionId(e.target.value)}
                          style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div>

                      
                      {showExamples && (
                        <div style={{ display: 'flex', gap: '1rem' }}>
                        {/* Group 1: Known Fraud */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'rgba(0,0,0,0.02)', padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', minWidth: '110px' }}>Known Fraud:</div>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button 
                              onClick={() => {
                                setTransactionId('10763569');
                                setFraudData(null);
                                setAiIfResults(null);
                              }}
                              style={{
                                padding: '0.25rem 0.75rem',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color)',
                                background: transactionId === '10763569' ? 'var(--cymbal-green)' : 'white',
                                color: transactionId === '10763569' ? 'white' : 'var(--text-primary)',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                fontWeight: transactionId === '10763569' ? 'bold' : 'normal'
                              }}
                            >
                              10763569
                            </button>
                            <button 
                              onClick={() => {
                                setTransactionId('10763601');
                                setFraudData(null);
                                setAiIfResults(null);
                              }}
                                style={{
                                padding: '0.25rem 0.75rem',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color)',
                                background: transactionId === '10763601' ? 'var(--cymbal-green)' : 'white',
                                color: transactionId === '10763601' ? 'white' : 'var(--text-primary)',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                fontWeight: transactionId === '10763601' ? 'bold' : 'normal'
                              }}
                            >
                              10763601
                            </button>
                            <button 
                              onClick={() => {
                                setTransactionId('10764636');
                                setFraudData(null);
                                setAiIfResults(null);
                              }}
                              style={{
                                padding: '0.25rem 0.75rem',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color)',
                                background: transactionId === '10764636' ? 'var(--cymbal-green)' : 'white',
                                color: transactionId === '10764636' ? 'white' : 'var(--text-primary)',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                fontWeight: transactionId === '10764636' ? 'bold' : 'normal'
                              }}
                            >
                              10764636
                            </button>
                          </div>
                        </div>

                        {/* Group 2: False Negatives */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'rgba(0,0,0,0.02)', padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', minWidth: '110px' }}>False Negatives:</div>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button 
                              onClick={() => {
                                setTransactionId('10773718');
                                setFraudData(null);
                                setAiIfResults(null);
                              }}
                              style={{
                                padding: '0.25rem 0.75rem',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color)',
                                background: transactionId === '10773718' ? 'var(--cymbal-green)' : 'white',
                                color: transactionId === '10773718' ? 'white' : 'var(--text-primary)',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                fontWeight: transactionId === '10773718' ? 'bold' : 'normal'
                              }}
                            >
                              10773718
                            </button>
                            <button 
                              onClick={() => {
                                setTransactionId('10777802');
                                setFraudData(null);
                                setAiIfResults(null);
                              }}
                              style={{
                                padding: '0.25rem 0.75rem',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color)',
                                background: transactionId === '10777802' ? 'var(--cymbal-green)' : 'white',
                                color: transactionId === '10777802' ? 'white' : 'var(--text-primary)',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                fontWeight: transactionId === '10777802' ? 'bold' : 'normal'
                              }}
                            >
                              10777802
                            </button>
                            <button 
                              onClick={() => {
                                setTransactionId('10794135');
                                setFraudData(null);
                                setAiIfResults(null);
                              }}
                              style={{
                                padding: '0.25rem 0.75rem',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color)',
                                background: transactionId === '10794135' ? 'var(--cymbal-green)' : 'white',
                                color: transactionId === '10794135' ? 'white' : 'var(--text-primary)',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                fontWeight: transactionId === '10794135' ? 'bold' : 'normal'
                              }}
                            >
                              10794135
                            </button>
                          </div>
                        </div>
                      </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Right Column: Metrics */}
                <div>

                </div>
              </div>

              {/* Centered Action Button */}
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.25rem', marginBottom: '0rem' }}>
                <button 
                  onClick={() => fetchFraudDetection(clientId, transactionId)}
                  style={{ 
                    background: 'linear-gradient(135deg, var(--cymbal-green) 0%, #10B981 100%)', 
                    color: 'white', 
                    border: 'none', 
                    padding: '0.75rem 3rem', 
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '1rem',
                    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
                    transition: 'transform 0.2s'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                  onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                >
                  Analyze Transaction ⚡
                </button>
              </div>
            </div>


          </div>
          )}

          {loadingFraud ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
              <div className="spinner" style={{ marginRight: '0.5rem' }}></div>
              <span>Analyzing transactions...</span>
            </div>
          ) : isStreaming ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <h3>Live Transaction Stream</h3>
              <p style={{ color: 'var(--text-secondary)' }}>Real-time transaction monitoring. Fraudulent anomalies are automatically highlighted.</p>
              <div style={{ 
                maxHeight: '600px', 
                overflowY: 'auto', 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center',
                gap: '1rem', 
                padding: '0.5rem', 
                background: 'var(--cymbal-bg-light)', 
                borderRadius: '8px' 
              }}>
                {streamingTransactions.length === 0 && <div style={{ textAlign: 'center', padding: '2rem' }}>Waiting for transactions...</div>}
                {streamingTransactions.map((tx, idx) => (
                  <div 
                    key={tx.id + "-" + idx} 
                    onClick={() => {
                      setIsStreaming(false);
                      setTransactionId(tx.id);
                      setClickedDate(tx.date);
                      fetchFraudDetection(0, tx.id);
                    }}
                    style={{ 
                      padding: '0.5rem 1rem', 
                      borderRadius: '8px', 
                      background: tx.is_fraud ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)', 
                      border: tx.is_fraud ? '2px solid #EF4444' : '2px solid #10B981',
                      cursor: 'pointer',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: '0.25rem',
                      width: '350px',
                      position: 'relative'
                    }}
                  >
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', width: '100%', textAlign: 'left' }}>
                      {new Date(tx.date).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'})} | ID: {tx.id}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginTop: '0.5rem' }}>
                      <div style={{ fontWeight: 'bold', fontSize: '1.1rem', color: tx.is_fraud ? '#EF4444' : '#065F46' }}>${tx.amount.toFixed(2)}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '180px', textAlign: 'right' }}>
                        Location: {tx.merchant_city}
                      </div>
                    </div>
                    <div style={{ 
                      background: tx.is_fraud ? '#EF4444' : '#10B981', 
                      color: 'white', 
                      padding: '0.25rem 0.5rem', 
                      borderRadius: '4px', 
                      fontSize: '0.75rem', 
                      fontWeight: 'bold',
                      position: 'absolute',
                      top: '0.5rem',
                      right: '1rem'
                    }}>
                      {tx.is_fraud ? 'Fraud' : 'Clear'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : fraudData ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              <div>
                <button 
                  onClick={() => setIsStreaming(true)} 
                  style={{ marginBottom: '1rem', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer' }}
                >
                  ← Back to Live Stream
                </button>
                <h3>Current Transaction</h3>
                <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', marginBottom: '1rem' }}>
                  {/* Recall */}
                  <div style={{ flex: 1, textAlign: 'center', background: 'rgba(0,0,0,0.02)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Recall</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--cymbal-green)' }}>
                      {aiIfEnabled ? 
                        (selectedThreshold === 0.011 ? '97.2%' : selectedThreshold === 0.021 ? '85.4%' : '80.6%') :
                        (selectedThreshold === 0.011 ? '93.4%' : selectedThreshold === 0.021 ? '79.9%' : '75.3%')}
                    </div>
                    {aiIfEnabled && (
                      <div style={{ fontSize: '0.75rem', color: '#10B981', fontWeight: 'bold', marginTop: '0.25rem' }}>
                        {selectedThreshold === 0.011 ? '+3.8%' : selectedThreshold === 0.021 ? '+5.5%' : '+5.3%'}
                      </div>
                    )}
                  </div>
                  {/* Accuracy */}
                  <div style={{ flex: 1, textAlign: 'center', background: 'rgba(0,0,0,0.02)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Accuracy</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--cymbal-green)' }}>
                      {aiIfEnabled ? 
                        (selectedThreshold === 0.011 ? '82.1%' : selectedThreshold === 0.021 ? '87.0%' : '86.8%') :
                        (selectedThreshold === 0.011 ? '86.7%' : selectedThreshold === 0.021 ? '84.4%' : '84.2%')}
                    </div>
                    {aiIfEnabled && (
                      <div style={{ fontSize: '0.75rem', color: selectedThreshold === 0.011 ? '#EF4444' : '#10B981', fontWeight: 'bold', marginTop: '0.25rem' }}>
                        {selectedThreshold === 0.011 ? '-4.6%' : selectedThreshold === 0.021 ? '+2.6%' : '+2.6%'}
                      </div>
                    )}
                  </div>
                  {/* False Positives */}
                  <div style={{ flex: 1, textAlign: 'center', background: 'rgba(0,0,0,0.02)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>False Positives</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#EF4444' }}>
                      {aiIfEnabled ? 
                        (selectedThreshold === 0.011 ? '33.0%' : selectedThreshold === 0.021 ? '11.4%' : '7.0%') :
                        (selectedThreshold === 0.011 ? '19.8%' : selectedThreshold === 0.021 ? '11.2%' : '7.2%')}
                    </div>
                    {aiIfEnabled && (
                      <div style={{ fontSize: '0.75rem', color: selectedThreshold === 0.031 ? '#10B981' : '#EF4444', fontWeight: 'bold', marginTop: '0.25rem' }}>
                        {selectedThreshold === 0.011 ? '+13.2%' : selectedThreshold === 0.021 ? '+0.2%' : '-0.2%'}
                      </div>
                    )}
                  </div>
                  {/* False Negatives */}
                  <div style={{ flex: 1, textAlign: 'center', background: 'rgba(0,0,0,0.02)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>False Negatives</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#EF4444' }}>
                      {aiIfEnabled ? 
                        (selectedThreshold === 0.011 ? '2.8%' : selectedThreshold === 0.021 ? '14.6%' : '19.4%') :
                        (selectedThreshold === 0.011 ? '6.6%' : selectedThreshold === 0.021 ? '20.1%' : '24.7%')}
                    </div>
                    {aiIfEnabled && (
                      <div style={{ fontSize: '0.75rem', color: '#10B981', fontWeight: 'bold', marginTop: '0.25rem' }}>
                        {selectedThreshold === 0.011 ? '-3.8%' : selectedThreshold === 0.021 ? '-5.5%' : '-5.3%'}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '2rem', marginTop: '1rem' }}>
                  {/* Card 1: Transaction Details */}
                  <div style={{ 
                    flex: 1, 
                    background: 'rgba(0,0,0,0.02)', 
                    padding: '1.5rem', 
                    borderRadius: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between'
                  }}>
                    <div>
                      <h4 style={{ marginBottom: '1rem' }}>Transaction Details</h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.9rem' }}>
                        <p><strong>ID:</strong> {fraudData.current_transaction.id}</p>
                        <p><strong>Date:</strong> {clickedDate ? new Date(clickedDate).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'}) : new Date(fraudData.current_transaction.date).toLocaleString()}</p>
                        <p><strong>Amount:</strong> ${fraudData.current_transaction.amount}</p>
                        <p><strong>Description:</strong> {fraudData.current_transaction.transaction_description}</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => {
                        setCurrentSql(fraudData.current_sql);
                        setShowDrawer(true);
                      }}
                      style={{ background: 'none', border: 'none', color: 'var(--cymbal-green)', cursor: 'pointer', padding: 0, marginTop: '1rem', alignSelf: 'flex-start' }}
                    >
                      Show SQL
                    </button>
                  </div>

                  {/* Card 2: Fraud Analysis Results */}
                  <div style={{ 
                    flex: 1.5, 
                    background: 'rgba(0,0,0,0.02)', 
                    padding: '1.5rem', 
                    borderRadius: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1.5rem'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h4 style={{ margin: 0 }}>Fraud Analysis</h4>
                      <div style={{ 
                        display: 'inline-block', 
                        padding: '0.5rem 1rem', 
                        borderRadius: '50px', 
                        fontWeight: 'bold',
                        fontSize: '0.9rem',
                        color: 'white',
                        background: isCombinedFraud ? '#EF4444' : 'var(--cymbal-green)'
                      }}>
                        {isCombinedFraud ? '🚨 Fraud Alert' : '✅ Clear'}
                      </div>
                    </div>

                    {(!aiIfEnabled || (aiIfResults && aiIfResults.skipped)) && (
                      <div style={{ 
                        background: 'rgba(0,0,0,0.03)', 
                        padding: '1rem', 
                        borderRadius: '8px',
                        textAlign: 'center',
                        marginTop: '1rem'
                      }}>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
                          {aiIfResults && aiIfResults.skipped ? 'Run AI.IF anyway for deeper analysis.' : 'Enable AI.IF to run advanced fraud checks.'}
                        </p>
                        <button 
                          onClick={() => {
                            setAiIfEnabled(true);
                            setForceAiIf(true);
                          }}
                          style={{ 
                            background: 'var(--cymbal-green)', 
                            color: 'white', 
                            border: 'none', 
                            padding: '0.5rem 1rem', 
                            borderRadius: '6px', 
                            cursor: 'pointer',
                            fontWeight: 'bold',
                            fontSize: '0.85rem',
                            transition: 'all 0.2s ease'
                          }}
                          onMouseOver={(e) => e.currentTarget.style.background = '#00BD58'}
                          onMouseOut={(e) => e.currentTarget.style.background = 'var(--cymbal-green)'}
                        >
                          Enhance with AI.IF()
                        </button>
                      </div>
                    )}

                    {aiIfEnabled && loadingAiIf && (
                      <div style={{ 
                        background: 'rgba(0,0,0,0.03)', 
                        padding: '1rem', 
                        borderRadius: '8px',
                        textAlign: 'center'
                      }}>
                        <div className="spinner" style={{ margin: '0 auto 0.5rem' }}></div>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                          Running AI.IF checks...
                        </p>
                      </div>
                    )}

                    {aiIfEnabled && aiIfResults && (
                      <div style={{ background: 'rgba(0,0,0,0.03)', padding: '1rem', borderRadius: '8px' }}>
                        <h5 style={{ marginBottom: '0.5rem' }}>AI.IF Verdicts:</h5>
                        {aiIfResults.skipped ? (
                          <div style={{ fontSize: '0.85rem', color: '#6B7280', fontStyle: 'italic', padding: '0.5rem 0' }}>
                            {aiIfResults.message}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                              <span>1. Card Testing?</span>
                              <span 
                                style={{ fontWeight: 'bold', color: aiIfResults.Q1 === 'Yes' ? '#EF4444' : 'var(--cymbal-green)', cursor: 'pointer', textDecoration: 'underline' }}
                                onClick={() => {
                                  setFraudPromptContent({ title: 'Card Testing?', prompt: aiIfResults.prompts ? aiIfResults.prompts.Q1 : 'Prompt not available' });
                                  setShowFraudPromptModal(true);
                                }}
                              >
                                {aiIfResults.Q1}
                              </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                              <span>2. Lifestyle Mismatch?</span>
                              <span 
                                style={{ fontWeight: 'bold', color: aiIfResults.Q2 === 'Yes' ? '#EF4444' : 'var(--cymbal-green)', cursor: 'pointer', textDecoration: 'underline' }}
                                onClick={() => {
                                  setFraudPromptContent({ title: 'Lifestyle Mismatch?', prompt: aiIfResults.prompts ? aiIfResults.prompts.Q2 : 'Prompt not available' });
                                  setShowFraudPromptModal(true);
                                }}
                              >
                                {aiIfResults.Q2}
                              </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                              <span>3. Structured Amounts?</span>
                              <span 
                                style={{ fontWeight: 'bold', color: aiIfResults.Q3 === 'Yes' ? '#EF4444' : 'var(--cymbal-green)', cursor: 'pointer', textDecoration: 'underline' }}
                                onClick={() => {
                                  setFraudPromptContent({ title: 'Structured Amounts?', prompt: aiIfResults.prompts ? aiIfResults.prompts.Q3 : 'Prompt not available' });
                                  setShowFraudPromptModal(true);
                                }}
                              >
                                {aiIfResults.Q3}
                              </span>
                            </div>
                          </div>
                        )}
                        <button 
                          onClick={() => {
                            setCurrentSql(aiIfResults.sql);
                            setIsAiIfDrawer(true);
                            setDrawerTab('array');
                            setShowDrawer(true);
                          }}
                          style={{ background: 'none', border: 'none', color: 'var(--cymbal-green)', cursor: 'pointer', padding: 0, marginTop: '0.5rem' }}
                        >
                          Show SQL
                        </button>
                      </div>
                    )}

                    {/* Distance Visualization inside Card */}
                    <div>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 'bold' }}>Vector Distance Score</span>
                      {(() => {
                        const maxScale = Math.max(selectedThreshold, fraudData.avg_distance);
                        const filledWidth = (fraudData.avg_distance / maxScale) * 100;
                        const thresholdPosition = (selectedThreshold / maxScale) * 100;
                        
                        return (
                          <>
                            <div style={{ background: 'rgba(0,0,0,0.05)', height: '16px', borderRadius: '8px', position: 'relative', marginTop: '1.5rem' }}>
                              <div style={{ 
                                background: fraudData.avg_distance > selectedThreshold ? '#EF4444' : 'var(--cymbal-green)', 
                                width: `${filledWidth}%`, 
                                height: '100%', 
                                borderRadius: '8px' 
                              }}></div>
                              <div style={{ 
                                position: 'absolute', 
                                left: `${thresholdPosition}%`, 
                                top: '-3px', 
                                bottom: '-3px', 
                                width: '2px', 
                                background: 'black' 
                              }} title={`Threshold: ${selectedThreshold}`}></div>
                              
                              <div style={{ 
                                position: 'absolute', 
                                left: `${filledWidth}%`, 
                                top: '-3px', 
                                bottom: '-3px', 
                                width: '2px', 
                                background: 'black' 
                              }} title={`Actual: ${fraudData.avg_distance.toFixed(4)}`}></div>
                              
                              {/* Floating Label Above Bar */}
                              <div style={{ 
                                position: 'absolute', 
                                left: `${fraudData.avg_distance > selectedThreshold ? thresholdPosition : filledWidth}%`, 
                                top: '-1.2rem', 
                                transform: 'translateX(-50%)',
                                fontSize: '0.75rem',
                                color: 'var(--text-secondary)',
                                whiteSpace: 'nowrap'
                              }}>
                                {fraudData.avg_distance > selectedThreshold ? `Threshold (${selectedThreshold})` : `Actual (${fraudData.avg_distance.toFixed(4)})`}
                              </div>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                              <span>0</span>
                              <span>{fraudData.avg_distance > selectedThreshold ? `Actual (${fraudData.avg_distance.toFixed(4)})` : `Threshold (${selectedThreshold})`}</span>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>
                  

                </div>

              <div>
                <h3>Customer's Most Similar Purchases</h3>
                <button 
                  onClick={() => {
                    setCurrentSql(fraudData.history_sql);
                    setShowDrawer(true);
                  }}
                  style={{ background: 'none', border: 'none', color: 'var(--cymbal-green)', cursor: 'pointer', padding: 0, marginTop: '0.5rem' }}
                >
                  Show SQL
                </button>
                <div style={{ marginTop: '1rem', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ background: 'rgba(0,0,0,0.05)', textAlign: 'left' }}>
                        <th style={{ padding: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>ID</th>
                        <th style={{ padding: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>Date</th>
                        <th style={{ padding: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>Amount</th>
                        <th style={{ padding: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>Card Brand</th>
                        <th style={{ padding: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>Card Type</th>
                        <th style={{ padding: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>Dark Web?</th>
                        <th style={{ padding: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>Merchant City</th>
                        <th style={{ padding: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>MCC Description</th>
                        <th style={{ padding: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>Distance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fraudData.history.map((tx) => (
                        <tr key={tx.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '0.5rem' }}>{tx.id}</td>
                          <td style={{ padding: '0.5rem' }}>{new Date(tx.date).toLocaleDateString()}</td>
                          <td style={{ padding: '0.5rem' }}>${tx.amount}</td>
                          <td style={{ padding: '0.5rem' }}>{tx.card_brand}</td>
                          <td style={{ padding: '0.5rem' }}>{tx.card_type}</td>
                          <td style={{ padding: '0.5rem' }}>{tx.card_on_dark_web === 't' ? 'Yes' : 'No'}</td>
                          <td style={{ padding: '0.5rem' }}>{tx.merchant_city}</td>
                          <td style={{ padding: '0.5rem' }}>{tx.mcc_description}</td>
                          <td style={{ padding: '0.5rem' }}>{tx.distance.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="glass" style={{ padding: '2rem', maxWidth: '1200px', width: '100%', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <h2>Lakehouse Federation Search</h2>
            <p>Querying transactional data in AlloyDB joined with Iceberg data in BigQuery.</p>
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', justifyContent: 'center' }}>
            <button 
              onClick={() => {
                setLakehouseTab('advanced');
                setLakehouseResults([]);
              }} 
              style={{ background: lakehouseTab === 'advanced' ? 'var(--cymbal-green)' : 'transparent', color: lakehouseTab === 'advanced' ? 'white' : 'var(--text-primary)', border: '1px solid var(--border-color)', padding: '0.5rem 1.25rem', borderRadius: '24px', fontWeight: 'bold', cursor: 'pointer' }}
            >
              Vector Search + Lakehouse Federation
            </button>
            <button 
              onClick={() => {
                setLakehouseTab('standard');
                setLakehouseResults([]);
              }} 
              style={{ background: lakehouseTab === 'standard' ? 'var(--cymbal-green)' : 'transparent', color: lakehouseTab === 'standard' ? 'white' : 'var(--text-primary)', border: '1px solid var(--border-color)', padding: '0.5rem 1.25rem', borderRadius: '24px', fontWeight: 'bold', cursor: 'pointer' }}
            >
              Historical 10K Lookup
            </button>
          </div>

          {lakehouseTab === 'standard' ? (
            <div className="search-box-wrapper glass" style={{ marginBottom: '2rem', width: '100%' }}>
              <div style={{ padding: '1.5rem' }}>
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'stretch', 
                  border: '1px solid var(--border-color)', 
                  borderRadius: '24px', 
                  overflow: 'hidden', 
                  background: 'white',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                  height: '48px'
                }}>
                  <input 
                    type="text" 
                    placeholder="Enter Ticker (e.g., CE)" 
                    value={lakehouseQuery}
                    onChange={(e) => setLakehouseQuery(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleLakehouseSearch();
                      }
                    }}
                    style={{ 
                      border: 'none', 
                      outline: 'none', 
                      padding: '0 1rem', 
                      flex: 1,
                      fontSize: '1rem'
                    }}
                  />
                  <button 
                    onClick={() => {
                      setCurrentSql(lakehouseSql);
                      setShowDrawer(!showDrawer);
                    }}
                    style={{ 
                      background: 'none', 
                      border: 'none', 
                      cursor: 'pointer', 
                      padding: '0 0.75rem', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      color: 'var(--text-secondary)'
                    }}
                    title="Lakehouse Federation SQL"
                  >
                    <span style={{ fontSize: '0.875rem', fontWeight: 'bold', fontFamily: 'monospace' }}>SQL</span>
                  </button>
                  <button 
                    onClick={handleLakehouseSearch}
                    style={{ 
                      borderRadius: '0 24px 24px 0', 
                      padding: '0 1.5rem', 
                      border: 'none', 
                      background: 'var(--cymbal-green)', 
                      color: 'white', 
                      fontWeight: 'bold',
                      cursor: 'pointer'
                    }}
                  >
                    Search
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="search-box-wrapper glass" style={{ marginBottom: '2rem', width: '100%' }}>
              <div style={{ padding: '1.5rem' }}>
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'stretch', 
                  border: '1px solid var(--border-color)', 
                  borderRadius: '24px', 
                  overflow: 'hidden', 
                  background: 'white',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                  height: '48px'
                }}>
                            <select
                              onChange={(e) => {
                                const idx = e.target.value;
                                if (idx === "") return;
                                const ex = SEARCH_EXAMPLES[idx];
                                setVectorQuery(ex.query);
                                const newFilters = {
                                  assets: 'none',
                                  liabilities: 'none',
                                  equity: 'none',
                                  cash: 'none',
                                  revenues: 'none',
                                  net_income: 'none',
                                  operating_income: 'none',
                                  gross_profit: 'none'
                                };
                                Object.keys(ex.filters).forEach(key => {
                                  newFilters[key] = ex.filters[key];
                                });
                                setFilters(newFilters);
                                setShowAllLakehouseFilters(true);
                              }}
                              style={{
                                border: 'none',
                                background: 'rgba(0,0,0,0.03)',
                                padding: '0 1rem',
                                outline: 'none',
                                borderRight: '1px solid var(--border-color)',
                                color: 'var(--text-primary)',
                                fontSize: '0.875rem',
                                cursor: 'pointer',
                                maxWidth: '150px',
                                fontWeight: '600'
                              }}
                              defaultValue=""
                            >
                              <option value="" disabled>Use Example</option>
                              {SEARCH_EXAMPLES.map((ex, idx) => (
                                <option key={idx} value={idx}>{ex.label}</option>
                              ))}
                            </select>
                  <input 
                    type="text" 
                    placeholder="Search term (e.g., exposure to middle east shipping)" 
                    value={vectorQuery}
                    onChange={(e) => setVectorQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleAdvancedSearch();
                      }
                    }}
                    style={{ 
                      border: 'none', 
                      outline: 'none', 
                      padding: '0 1rem', 
                      flex: 1,
                      fontSize: '1rem'
                    }}
                  />
                  <button 
                    onClick={() => {
                      setCurrentSql(lakehouseSql);
                      setShowDrawer(!showDrawer);
                    }}
                    style={{ 
                      background: 'none', 
                      border: 'none', 
                      cursor: 'pointer', 
                      padding: '0 0.75rem', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      color: 'var(--text-secondary)'
                    }}
                    title="Advanced Search SQL"
                  >
                    <span style={{ fontSize: '0.875rem', fontWeight: 'bold', fontFamily: 'monospace' }}>SQL</span>
                  </button>
                  <button 
                    onClick={handleAdvancedSearch}
                    style={{ 
                      borderRadius: '0 24px 24px 0', 
                      padding: '0 1.5rem', 
                      border: 'none', 
                      background: 'var(--cymbal-green)', 
                      color: 'white', 
                      fontWeight: 'bold',
                      cursor: 'pointer'
                    }}
                  >
                    Search
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', marginTop: '1rem' }}>
                  <label style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    color: 'var(--text-primary)',
                    fontWeight: 'bold'
                  }}>
                    <div style={{
                      position: 'relative',
                      width: '36px',
                      height: '20px',
                      background: useReverseEtl ? 'var(--cymbal-green)' : '#CCC',
                      borderRadius: '10px',
                      transition: 'background 0.2s ease'
                    }}>
                      <div style={{
                        position: 'absolute',
                        top: '2px',
                        left: useReverseEtl ? '18px' : '2px',
                        width: '16px',
                        height: '16px',
                        background: 'white',
                        borderRadius: '50%',
                        transition: 'left 0.2s ease',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                      }} />
                    </div>
                    <span>Use Reverse ETL</span>
                    <input 
                      type="checkbox" 
                      checked={useReverseEtl} 
                      onChange={(e) => setUseReverseEtl(e.target.checked)}
                      style={{ display: 'none' }} 
                    />
                  </label>

                  <label style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    color: 'var(--text-primary)',
                    fontWeight: 'bold'
                  }}>
                    <div style={{
                      position: 'relative',
                      width: '36px',
                      height: '20px',
                      background: showAllLakehouseFilters ? 'var(--cymbal-green)' : '#CCC',
                      borderRadius: '10px',
                      transition: 'background 0.2s ease'
                    }}>
                      <div style={{
                        position: 'absolute',
                        top: '2px',
                        left: showAllLakehouseFilters ? '18px' : '2px',
                        width: '16px',
                        height: '16px',
                        background: 'white',
                        borderRadius: '50%',
                        transition: 'left 0.2s ease',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                      }} />
                    </div>
                    <span>Show Lakehouse Filters</span>
                    <input 
                      type="checkbox" 
                      checked={showAllLakehouseFilters} 
                      onChange={(e) => setShowAllLakehouseFilters(e.target.checked)}
                      style={{ display: 'none' }} 
                    />
                  </label>
                </div>
              </div>
              
              {showAllLakehouseFilters && (
                <div style={{ 
                  padding: '1.5rem', 
                  borderTop: '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1rem'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>Filters</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', width: '100%' }}>
                    {Object.keys(filters).map(metric => (
                      <div key={metric} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'capitalize', color: 'var(--text-secondary)' }}>
                          {metric.replace('_', ' ')}
                        </label>
                        <select 
                          value={filters[metric]} 
                          onChange={(e) => setFilters({...filters, [metric]: e.target.value})}
                          style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'white', color: 'var(--text-primary)', outline: 'none' }}
                        >
                          <option value="none">None</option>
                          <option value="low">Low (&lt; 100M)</option>
                          <option value="medium">Medium (100M - 1B)</option>
                          <option value="high">High (&gt; 1B)</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {loadingLakehouse ? (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              {lakehouseTab === 'advanced' ? (
                <>Running vector search on <strong>AlloyDB</strong> and filtering with <strong>Lakehouse Federation</strong></>
              ) : (
                <>Loading data from <strong>Google Cloud Lakehouse Tables for Apache Iceberg</strong>...</>
              )}
            </div>
          ) : lakehouseResults.length > 0 ? (
            <div>
              <h3>Results from Federated Query</h3>
              <div style={{ width: '100%', overflowX: 'auto', marginTop: '1rem' }}>
                <table style={{ width: '100%', minWidth: '1200px', borderCollapse: 'collapse', textAlign: 'left' }}>
                            <thead>
                              {lakehouseTab === 'advanced' ? (
                                <>
                                  <tr style={{ borderBottom: 'none', background: 'rgba(0,0,0,0.02)' }}>
                                    <th colSpan={3} style={{ padding: '0.75rem 1.5rem 0.75rem 0.5rem', textAlign: 'center', fontSize: '0.85rem', borderRight: '3px solid var(--border-color)', background: 'rgba(0, 169, 79, 0.03)' }}>
                                      <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', color: 'var(--cymbal-green)', fontWeight: 'bold' }}>
                                        <img src="/alloydb-logo.png" alt="AlloyDB" style={{ height: '18px', width: 'auto' }} />
                                        AlloyDB Data
                                      </div>
                                    </th>
                                    <th colSpan={10} style={{ padding: '0.75rem 0.5rem', textAlign: 'left', fontSize: '0.85rem', background: 'rgba(26, 115, 232, 0.03)' }}>
                                      <div style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '0.5rem',
                                        color: '#1a73e8',
                                        fontWeight: 'bold',
                                        width: 'max-content',
                                        marginLeft: '260px',
                                        position: 'sticky',
                                        left: '50%'
                                      }}>
                                        <img src="/bigquery-logo.png" alt="BigQuery" style={{ height: '18px', width: 'auto' }} />
                                        Lakehouse Data
                                      </div>
                                    </th>
                                  </tr>
                                  <tr style={{ borderBottom: '2px solid var(--text-secondary)' }}>
                                    <th style={{ padding: '0.75rem 0.5rem 0.75rem 1.25rem', background: 'rgba(0, 169, 79, 0.05)', color: 'var(--cymbal-green)', whiteSpace: 'nowrap' }}>Ticker</th>
                                    <th style={{ padding: '0.75rem 0.5rem', background: 'rgba(0, 169, 79, 0.05)', color: 'var(--cymbal-green)', whiteSpace: 'nowrap', textAlign: 'center' }}>Distance</th>
                                    <th style={{ padding: '0.75rem 1.5rem 0.75rem 0.5rem', background: 'rgba(0, 169, 79, 0.05)', color: 'var(--cymbal-green)', borderRight: '3px solid var(--border-color)', whiteSpace: 'nowrap', textAlign: 'center' }}>Chunk Text</th>
                                    <th style={{ padding: '0.75rem 0.5rem 0.75rem 1.5rem', background: 'rgba(26, 115, 232, 0.05)', color: '#1a73e8', whiteSpace: 'nowrap', textAlign: 'center' }}>History</th>
                                    <th style={{ padding: '0.75rem 0.5rem', background: 'rgba(26, 115, 232, 0.05)', color: '#1a73e8', whiteSpace: 'nowrap' }}>Assets</th>
                                    <th style={{ padding: '0.75rem 0.5rem', background: 'rgba(26, 115, 232, 0.05)', color: '#1a73e8', whiteSpace: 'nowrap' }}>Liabilities</th>
                                    <th style={{ padding: '0.75rem 0.5rem', background: 'rgba(26, 115, 232, 0.05)', color: '#1a73e8', whiteSpace: 'nowrap' }}>Equity</th>
                                    <th style={{ padding: '0.75rem 0.5rem', background: 'rgba(26, 115, 232, 0.05)', color: '#1a73e8', whiteSpace: 'nowrap' }}>Cash</th>
                                    <th style={{ padding: '0.75rem 0.5rem', background: 'rgba(26, 115, 232, 0.05)', color: '#1a73e8', whiteSpace: 'nowrap' }}>Operating Cash</th>
                                    <th style={{ padding: '0.75rem 0.5rem', background: 'rgba(26, 115, 232, 0.05)', color: '#1a73e8', whiteSpace: 'nowrap' }}>Revenues</th>
                                    <th style={{ padding: '0.75rem 0.5rem', background: 'rgba(26, 115, 232, 0.05)', color: '#1a73e8', whiteSpace: 'nowrap' }}>Net Income</th>
                                    <th style={{ padding: '0.75rem 0.5rem', background: 'rgba(26, 115, 232, 0.05)', color: '#1a73e8', whiteSpace: 'nowrap' }}>Operating Income</th>
                                    <th style={{ padding: '0.75rem 0.5rem', background: 'rgba(26, 115, 232, 0.05)', color: '#1a73e8', whiteSpace: 'nowrap' }}>Gross Profit</th>
                                  </tr>
                                </>
                              ) : (
                                  <tr style={{ borderBottom: '2px solid var(--text-secondary)' }}>
                                    <th style={{ padding: '0.5rem' }}>Ticker</th>
                                    <th style={{ padding: '0.5rem' }}>Date</th>
                                    <th style={{ padding: '0.5rem' }}>{lakehouseQuery.includes(' ') ? 'Revenues (External BigQuery)' : '1-Day Return'}</th>
                                    <th style={{ padding: '0.5rem' }}>{lakehouseQuery.includes(' ') ? 'Fiscal Year' : '40-Day Return'}</th>
                                  </tr>
                              )}
                </thead>
                <tbody>
                  {lakehouseResults.map((res, index) => (
                    <tr key={index} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                      {lakehouseTab === 'advanced' ? (
                        <>
                          <td style={{ padding: '0.5rem 0.5rem 0.5rem 1.25rem', background: 'rgba(0, 169, 79, 0.015)' }}>
                            <a
                              href={`https://www.google.com/search?q=${res.ticker}+stock`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => {
                                e.preventDefault();
                                setActiveTicker(res.ticker);
                                setShowTickerModal(true);
                                if (activeTab === 'lakehouse') {
                                  setIsEnhanced(true);
                                  fetchCompanyOverview(res.ticker);
                                  fetchTickerExposure(res.ticker);
                                } else {
                                  setIsEnhanced(false);
                                }
                              }}
                              style={{ color: 'var(--cymbal-green)', textDecoration: 'underline', cursor: 'pointer', fontWeight: 'bold' }}
                            >
                              {res.ticker}
                            </a>
                          </td>
                          <td style={{ padding: '0.5rem', fontSize: '0.85rem', background: 'rgba(0, 169, 79, 0.015)', textAlign: 'center' }}>{res.distance ? Number(res.distance).toFixed(4) : 'N/A'}</td>
                          <td style={{ padding: '0.5rem 1.5rem 0.5rem 0.5rem', fontSize: '0.85rem', maxWidth: '250px', background: 'rgba(0, 169, 79, 0.015)', borderRight: '3px solid var(--border-color)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                              <span
                                style={{ color: 'var(--cymbal-green)', cursor: 'pointer', textDecoration: 'underline' }}
                                onClick={() => setAdvancedModalText({ ticker: res.ticker, chunk_index: res.chunk_index, text: res.remote_item_1 })}
                              >
                                {res.remote_item_1 ? "View" : 'N/A'}
                              </span>
                              {res.remote_item_1 && (
                                <button
                                  onClick={() => handleAnalyzeChunk({ ticker: res.ticker, chunk_index: res.chunk_index, text: res.remote_item_1, query: vectorQuery })}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', display: 'flex', alignItems: 'center' }}
                                  title="Analyze with Gemini"
                                >
                                  <img src="/gemini-logo.png" alt="Gemini" style={{ height: '18px', width: 'auto' }} />
                                </button>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: '0.5rem 0.5rem 0.5rem 1.5rem', fontSize: '0.85rem', background: 'rgba(26, 115, 232, 0.015)', textAlign: 'center' }}>
                            <span
                              style={{ color: '#1a73e8', cursor: 'pointer', textDecoration: 'underline' }}
                              onClick={() => {
                                setLakehouseTab('standard');
                                setLakehouseQuery(res.ticker);
                                handleLakehouseSearch(res.ticker);
                              }}
                            >
                              Prev. 10K's
                            </span>
                          </td>
                          <td style={{ padding: '0.5rem', fontSize: '0.85rem', background: 'rgba(26, 115, 232, 0.015)' }}>{res.assets ? `$${Number(res.assets).toLocaleString()}` : 'N/A'}</td>
                          <td style={{ padding: '0.5rem', fontSize: '0.85rem', background: 'rgba(26, 115, 232, 0.015)' }}>{res.liabilities ? `$${Number(res.liabilities).toLocaleString()}` : 'N/A'}</td>
                          <td style={{ padding: '0.5rem', fontSize: '0.85rem', background: 'rgba(26, 115, 232, 0.015)' }}>{res.equity ? `$${Number(res.equity).toLocaleString()}` : 'N/A'}</td>
                          <td style={{ padding: '0.5rem', fontSize: '0.85rem', background: 'rgba(26, 115, 232, 0.015)' }}>{res.cash ? `$${Number(res.cash).toLocaleString()}` : 'N/A'}</td>
                          <td style={{ padding: '0.5rem', fontSize: '0.85rem', background: 'rgba(26, 115, 232, 0.015)' }}>{res.operating_cash_flow ? `$${Number(res.operating_cash_flow).toLocaleString()}` : 'N/A'}</td>
                          <td style={{ padding: '0.5rem', fontSize: '0.85rem', background: 'rgba(26, 115, 232, 0.015)' }}>{res.revenues ? `$${Number(res.revenues).toLocaleString()}` : 'N/A'}</td>
                          <td style={{ padding: '0.5rem', fontSize: '0.85rem', background: 'rgba(26, 115, 232, 0.015)' }}>{res.net_income ? `$${Number(res.net_income).toLocaleString()}` : 'N/A'}</td>
                          <td style={{ padding: '0.5rem', fontSize: '0.85rem', background: 'rgba(26, 115, 232, 0.015)' }}>{res.operating_income ? `$${Number(res.operating_income).toLocaleString()}` : 'N/A'}</td>
                          <td style={{ padding: '0.5rem', fontSize: '0.85rem', background: 'rgba(26, 115, 232, 0.015)' }}>{res.gross_profit ? `$${Number(res.gross_profit).toLocaleString()}` : 'N/A'}</td>
                        </>
                      ) : (
                        <>
                            <td style={{ padding: '0.5rem' }}>
                              <a
                                href={`https://www.google.com/search?q=${res.ticker}+stock`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setActiveTicker(res.ticker);
                                  setShowTickerModal(true);
                                  if (activeTab === 'lakehouse') {
                                    setIsEnhanced(true);
                                    fetchCompanyOverview(res.ticker);
                                    fetchTickerExposure(res.ticker);
                                  } else {
                                    setIsEnhanced(false);
                                  }
                                }}
                                style={{ color: 'var(--cymbal-green)', textDecoration: 'underline', cursor: 'pointer', fontWeight: 'bold' }}
                              >
                                {res.ticker}
                              </a>
                            </td>
                            <td style={{ padding: '0.5rem', fontSize: '0.85rem' }}>
                              {res.date ? (
                                <span 
                                  style={{ color: 'var(--cymbal-green)', cursor: 'pointer', textDecoration: 'underline' }}
                                  onClick={() => handleDateClick(res.ticker, res.date)}
                                >
                                  {new Date(res.date).toLocaleDateString()}
                                </span>
                              ) : 'N/A'}
                            </td>
                            <td style={{ padding: '0.5rem' }}>{res.f_1_day_return ? `${((Number(res.f_1_day_return) - 1) * 100).toFixed(2)}%` : 'N/A'}</td>
                            <td style={{ padding: '0.5rem' }}>{res.f_40_day_return ? `${((Number(res.f_40_day_return) - 1) * 100).toFixed(2)}%` : 'N/A'}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
              

            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
              {lakehouseTab === 'advanced' ? "No results. Try an example query." : "No results. Try searching for a mapped ticker like 'CE'."}
            </div>
          )}
        </div>
      )}

      {/* Advanced Chunk Modal */}
      {advancedModalText && (
        <div 
          onClick={() => setAdvancedModalText(null)}
          style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'white', padding: '2rem', borderRadius: '8px', maxWidth: '800px', width: '90%', maxHeight: '80vh', overflowY: 'auto', position: 'relative' }}
          >
            <button 
              onClick={() => setAdvancedModalText(null)}
              style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'transparent', border: 'none', fontSize: '1.5rem', cursor: 'pointer' }}
            >
              ×
            </button>
            <h3 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text-primary)' }}>Chunk Text Details</h3>
              <div style={{ whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,0.02)', padding: '1rem', borderRadius: '4px', fontSize: '0.9rem', lineHeight: '1.6', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                {advancedModalText.text}
              </div>
              {advancedModalText.chunk_index !== undefined && (
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <button
                    onClick={() => {
                      const ex = advancedModalText;
                      setAdvancedModalText(null);
                      handleAnalyzeChunk({ ticker: ex.ticker, chunk_index: ex.chunk_index, text: ex.text, query: vectorQuery });
                    }}
                    style={{
                      background: 'none',
                      border: '1px solid var(--cymbal-green)',
                      color: 'var(--cymbal-green)',
                      padding: '0.5rem 1rem',
                      borderRadius: '24px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      fontWeight: 'bold',
                      fontSize: '0.875rem'
                    }}
                  >
                    <img src="/gemini-logo.png" alt="Gemini" style={{ height: '18px', width: 'auto', marginRight: '0.5rem' }} />
                    Explain with Gemini
                  </button>
                </div>
              )}
          </div>
        </div>
      )}

      {/* Show SQL Drawer */}
      {showDrawer && (
        <div 
          onClick={() => setShowDrawer(false)}
          style={{ 
            position: 'fixed', 
            top: 0, 
            left: 0, 
            width: '100%', 
            height: '100%', 
            background: 'rgba(0,0,0,0.3)', 
            zIndex: 3000 
          }}
        />
      )}
      <div 
        className={`drawer ${showDrawer ? 'drawer-open' : ''}`}
        style={{ '--drawer-width': `${drawerWidth}px`, zIndex: 3001 }}
      >
        <div 
          onMouseDown={() => setIsResizing(true)}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '8px',
            height: '100%',
            cursor: 'ew-resize',
            background: isResizing ? 'var(--cymbal-green)' : 'transparent',
            zIndex: 10
          }}
        />
        <div style={{ 
          overflowY: 'auto', 
          flex: 1, 
          padding: '2rem', 
          display: 'flex', 
          flexDirection: 'column' 
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2>{activeTab === 'lakehouse' ? 'Lakehouse Federation SQL' : 'Executed SQL'}</h2>
            <button style={{ background: 'none', color: 'var(--text-primary)', fontSize: '1.5rem', padding: '0.25rem', border: 'none', cursor: 'pointer' }} onClick={() => setShowDrawer(false)}>×</button>
          </div>
          {isAiIfDrawer && (
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <button 
                style={{ 
                  background: drawerTab === 'array' ? 'var(--cymbal-green)' : 'rgba(0,0,0,0.05)', 
                  color: drawerTab === 'array' ? 'white' : 'var(--text-primary)',
                  border: 'none',
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.875rem'
                }}
                onClick={() => setDrawerTab('array')}
              >
                Array-based Processing
              </button>
              <button 
                style={{ 
                  background: drawerTab === 'bulk' ? 'var(--cymbal-green)' : 'rgba(0,0,0,0.05)', 
                  color: drawerTab === 'bulk' ? 'white' : 'var(--text-primary)',
                  border: 'none',
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.875rem'
                }}
                onClick={() => setDrawerTab('bulk')}
              >
                Bulk Processing
              </button>
            </div>
          )}
          {activeTab === 'lakehouse' && lakehouseTab === 'advanced' && (
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <button 
                style={{ 
                  background: lakehouseDrawerTab === 'lakehouse' ? 'var(--cymbal-green)' : 'rgba(0,0,0,0.05)', 
                  color: lakehouseDrawerTab === 'lakehouse' ? 'white' : 'var(--text-primary)',
                  border: 'none',
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.875rem'
                }}
                onClick={() => setLakehouseDrawerTab('lakehouse')}
              >
                Lakehouse Federation
              </button>
              <button 
                style={{ 
                  background: lakehouseDrawerTab === 'reverse_etl' ? 'var(--cymbal-green)' : 'rgba(0,0,0,0.05)', 
                  color: lakehouseDrawerTab === 'reverse_etl' ? 'white' : 'var(--text-primary)',
                  border: 'none',
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.875rem'
                }}
                onClick={() => setLakehouseDrawerTab('reverse_etl')}
              >
                Reverse ETL
              </button>
            </div>
          )}
          <pre style={{ 
            background: 'rgba(0,0,0,0.05)', 
            padding: '1rem', 
            borderRadius: '8px', 
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
            fontSize: '0.875rem',
            fontFamily: 'monospace',
            minHeight: '200px',
            flexShrink: 0
          }}>
            {activeTab === 'lakehouse' && lakehouseTab === 'advanced' && lakehouseDrawerTab === 'reverse_etl' 
              ? REVERSE_ETL_SQL 
              : (isAiIfDrawer && drawerTab === 'bulk' ? BULK_SQL_QUERY : currentSql)}
          </pre>
          {(!isAiIfDrawer || drawerTab !== 'bulk') && (
            <>
              <button 
                onClick={handleExplain} 
                disabled={explaining || !currentSql}
                style={{ 
                  marginTop: '1rem', 
                  width: '100%',
                  background: 'none',
                  border: '1px solid var(--cymbal-green)',
                  color: 'var(--cymbal-green)',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem'
                }}
              >
                {explaining ? 'Explaining...' : 'Explain Query'}
              </button>
              {explainPlan && (
                <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <h3>Explain Plan:</h3>
                  <pre style={{ 
                    background: 'rgba(0,0,0,0.05)', 
                    padding: '1rem', 
                    borderRadius: '8px', 
                    overflowX: 'auto',
                    whiteSpace: 'pre-wrap',
                    fontSize: '0.875rem',
                    fontFamily: 'monospace',
                    flex: 1
                  }}>
                    {explainPlan}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Gemini Analysis Modal */}
      {showModal && (
        <div 
          onClick={() => setShowModal(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 2000
          }}
        >
          <div 
            className="glass" 
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white',
              padding: '2rem',
              borderRadius: '12px',
              maxWidth: '600px',
              width: '90%',
              maxHeight: '80vh',
              overflowY: 'auto',
              position: 'relative'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ color: 'var(--cymbal-green)' }}>
                Gemini Analysis via AlloyDB AI Functions
              </h2>
            </div>
            <button 
              style={{ 
                position: 'absolute', 
                top: '1rem', 
                right: '1rem', 
                background: 'none', 
                border: 'none', 
                fontSize: '1.5rem', 
                cursor: 'pointer',
                color: 'var(--text-secondary)'
              }}
              onClick={() => setShowModal(false)}
            >×</button>
            
            {loadingModal ? (
              <div style={{ textAlign: 'center', padding: '2rem' }}>
                Analyzing chunk with AlloyDB AI Functions...
              </div>
            ) : (
              <div>
                <div style={{ marginBottom: '1.5rem' }}>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    Relevance
                    <img src="/alloydb-logo.png" alt="AlloyDB" style={{ width: '24px', height: '24px' }} />
                  </h3>
                  <div style={{ marginBottom: '0.5rem' }}>
                    <code>ai.generate()</code>
                  </div>
                  <div style={{ background: 'rgba(0,0,0,0.02)', padding: '1rem', borderRadius: '8px', whiteSpace: 'pre-wrap' }}>
                    {modalContent.explanation}
                  </div>
                </div>
                <div style={{ marginBottom: '1.5rem' }}>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    Summary
                    <img src="/alloydb-logo.png" alt="AlloyDB" style={{ width: '24px', height: '24px' }} />
                  </h3>
                  <div style={{ marginBottom: '0.5rem' }}>
                    <code>ai.summarize()</code>
                  </div>
                  <div style={{ background: 'rgba(0,0,0,0.02)', padding: '1rem', borderRadius: '8px', whiteSpace: 'pre-wrap' }}>
                    {modalContent.summary}
                  </div>
                </div>
                <div>
                  <button 
                    onClick={() => setShowModalSql(!showModalSql)}
                    style={{ background: 'none', border: 'none', color: 'var(--cymbal-green)', cursor: 'pointer', padding: 0 }}
                  >
                    {showModalSql ? 'Hide SQL' : 'Show SQL'}
                  </button>
                  {showModalSql && (
                    <pre style={{ 
                      background: 'rgba(0,0,0,0.05)', 
                      padding: '1rem', 
                      borderRadius: '8px', 
                      overflowX: 'auto',
                      whiteSpace: 'pre-wrap',
                      fontSize: '0.875rem',
                      fontFamily: 'monospace',
                      marginTop: '0.5rem'
                    }}>
                      {modalContent.sql}
                    </pre>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      
      {showFraudPromptModal && (
        <div 
          onClick={() => setShowFraudPromptModal(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 2000
          }}
        >
          <div 
            className="glass" 
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white',
              padding: '2rem',
              borderRadius: '12px',
              maxWidth: '600px',
              width: '90%',
              maxHeight: '80vh',
              overflowY: 'auto',
              position: 'relative'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ color: 'var(--cymbal-green)' }}>
                {fraudPromptContent.title}
              </h2>
            </div>
            <button 
              style={{ 
                position: 'absolute', 
                top: '1rem', 
                right: '1rem', 
                background: 'none', 
                border: 'none', 
                fontSize: '1.5rem', 
                cursor: 'pointer',
                color: 'var(--text-secondary)'
              }}
              onClick={() => setShowFraudPromptModal(false)}
            >×</button>
            
            <div>
              <div style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  AI.IF Prompt
                </h3>
                <div style={{ background: 'rgba(0,0,0,0.02)', padding: '1rem', borderRadius: '8px', whiteSpace: 'pre-wrap', fontSize: '0.9rem' }}>
                  {fraudPromptContent.prompt}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
      {showTickerModal && (
        <div 
          className="modal-backdrop" 
          onClick={() => setShowTickerModal(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 2000
          }}
        >
          <div 
            className="glass" 
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white',
              padding: '2rem',
              borderRadius: '12px',
              maxWidth: '800px',
              width: '90%',
              maxHeight: '80vh',
              overflowY: 'auto',
              position: 'relative'
            }}
          >
            <button 
              style={{ 
                position: 'absolute', 
                top: '1rem', 
                right: '1rem', 
                background: 'none', 
                border: 'none', 
                fontSize: '1.5rem', 
                cursor: 'pointer',
                color: 'var(--text-secondary)'
              }}
              onClick={() => setShowTickerModal(false)}
            >×</button>
            <h2 style={{ color: 'var(--cymbal-green)', marginBottom: '1.5rem', textAlign: 'center', fontSize: '1.8rem' }}>
              Ticker Info: {activeTicker}
            </h2>
            


            {isEnhanced && (
              <>
                {hasMapping && activeTab !== 'lakehouse' && (
                  <div style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
                    <button
                      onClick={() => {
                        setActiveTab('lakehouse');
                        setLakehouseTab('standard');
                        setLakehouseQuery(activeTicker);
                        handleLakehouseSearch(activeTicker);
                        setShowTickerModal(false);
                      }}
                      style={{ background: 'var(--cymbal-green)', color: 'white', padding: '0.75rem 1.5rem', borderRadius: '24px', border: 'none', fontWeight: 'bold', cursor: 'pointer', fontSize: '1rem' }}
                    >
                      Explore Lakehouse
                    </button>
                  </div>
                )}
                <div style={{ marginBottom: '2rem' }}>
                  <h3 style={{ color: 'var(--cymbal-green)', marginBottom: '0.5rem' }}>
                    Company Overview
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: 'bold' }}>Powered by AlloyDB AI</span>
                    <img src="/alloydb-logo.png" alt="AlloyDB" style={{ height: '20px', width: 'auto' }} />
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: 'bold' }}>& Lakehouse Federation</span>
                    <img src="/bigquery-logo.png" alt="BigQuery" style={{ height: '20px', width: 'auto' }} />
                  </div>
                  {loadingOverview ? (
                    <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic', padding: '1rem', background: 'rgba(0,0,0,0.02)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div className="spinner"></div>
                      <img src="/gemini-logo.png" alt="Gemini" style={{ height: '20px', width: 'auto' }} />
                      <span>Gathering <strong>world knowledge</strong> with <strong>Gemini</strong>...</span>
                    </div>
                  ) : companyOverview ? (
                    companyOverview.error ? (
                      <div style={{ color: 'red' }}>Error: {companyOverview.error}</div>
                    ) : (
                      <div style={{ background: 'rgba(0,0,0,0.02)', padding: '1rem', borderRadius: '8px' }}>
                        <p><strong>Entity Name:</strong> {companyOverview.Security_Name}</p>
                        <p style={{ marginTop: '1rem', whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{companyOverview.overview}</p>
                        
                        <div style={{ marginTop: '1rem' }}>
                          <button 
                            onClick={() => setShowOverviewSql(!showOverviewSql)}
                            style={{ background: 'none', border: 'none', color: 'var(--cymbal-green)', cursor: 'pointer', padding: 0, fontWeight: 'bold', fontSize: '0.9rem' }}
                          >
                            {showOverviewSql ? 'Hide SQL' : 'Show SQL'}
                          </button>
                          {showOverviewSql && (
                            <pre style={{ 
                              background: 'rgba(0,0,0,0.05)', 
                              padding: '1rem', 
                              borderRadius: '8px', 
                              overflowX: 'auto',
                              whiteSpace: 'pre-wrap',
                              fontSize: '0.875rem',
                              fontFamily: 'monospace',
                              marginTop: '0.5rem'
                            }}>
{`-- Company Overview Query (AlloyDB AI and Lakehouse Federation)
SELECT "Security_Name", 
       ai.generate('Provide a Company Overview for the following company, including its primary lines of business, location, and other relevant facts: ' || "Security_Name" || '(' || "Symbol" || ')') as overview
FROM public.ext_stock_metadata 
WHERE "Symbol" = '${activeTicker}';`}
                            </pre>
                          )}
                        </div>
                      </div>
                    )
                  ) : (
                    <div>No overview available.</div>
                  )}
                </div>

                <div style={{ marginTop: '2rem' }}>
                  <div style={{ marginBottom: '1rem' }}>
                    <h3 style={{ color: 'var(--cymbal-green)', marginBottom: '0.25rem' }}>
                      Top Institutional Holders (Form 13F)
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: 'bold' }}>Powered by Lakehouse Federation</span>
                      <img src="/alloydb-logo.png" alt="AlloyDB" style={{ height: '20px', width: 'auto' }} />
                      <img src="/bigquery-logo.png" alt="BigQuery" style={{ height: '20px', width: 'auto' }} />
                    </div>
                  </div>
                  {loadingExposure ? (
                    <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic', padding: '1rem', background: 'rgba(0,0,0,0.02)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div className="spinner"></div>
                      <img src="/bigquery-logo.png" alt="BigQuery" style={{ height: '20px', width: 'auto' }} />
                      <span>Loading <strong>reference data</strong> from <strong>Lakehouse</strong>...</span>
                    </div>
                  ) : tickerExposure.length === 0 ? (
                    <div>No 13F exposure data found for this ticker.</div>
                  ) : (
                    <>
                      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                          <tr style={{ borderBottom: '2px solid var(--text-secondary)' }}>
                            <th style={{ padding: '0.75rem' }}>Manager Name</th>
                            <th style={{ padding: '0.75rem' }}>Shares</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tickerExposure.map((holder, index) => (
                            <tr key={index} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                              <td style={{ padding: '0.75rem' }}>{holder.manager_name}</td>
                              <td style={{ padding: '0.75rem' }}>{holder.shares.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      
                      <div style={{ marginTop: '1rem' }}>
                        <button 
                          onClick={() => setShowHoldingsSql(!showHoldingsSql)}
                          style={{ background: 'none', border: 'none', color: 'var(--cymbal-green)', cursor: 'pointer', padding: 0, fontWeight: 'bold', fontSize: '0.9rem' }}
                        >
                          {showHoldingsSql ? 'Hide SQL' : 'Show SQL'}
                        </button>
                        {showHoldingsSql && (
                          <pre style={{ 
                            background: 'rgba(0,0,0,0.05)', 
                            padding: '1rem', 
                            borderRadius: '8px', 
                            overflowX: 'auto',
                            whiteSpace: 'pre-wrap',
                            fontSize: '0.875rem',
                            fontFamily: 'monospace',
                            marginTop: '0.5rem'
                          }}>
{`-- Institutional Holders Query (Lakehouse Federation)
SELECT manager_name, shares, value_usd 
FROM ext_sec_13f_holdings 
WHERE ticker = '${activeTicker}' 
ORDER BY value_usd DESC 
LIMIT 5;`}
                          </pre>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}

            <div style={{ marginTop: '2rem', marginBottom: '2rem' }}>
              <h3 style={{ color: 'var(--cymbal-green)', marginBottom: '1rem' }}>
                Recent Performance
              </h3>
              <TradingViewWidget key={activeTicker} ticker={activeTicker} />
            </div>



            {activeTab !== 'lakehouse' && !isEnhanced && (
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                  <button 
                    style={{ 
                      background: 'linear-gradient(135deg, var(--cymbal-green), #0b6636)', 
                      color: 'white', 
                      border: 'none', 
                      padding: '0.5rem 1.5rem', 
                      borderRadius: '50px', 
                      fontSize: '0.9rem', 
                      fontWeight: 'bold', 
                      cursor: 'pointer', 
                      boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '1rem'
                    }}
                    onClick={() => {
                      setIsEnhanced(true);
                      fetchCompanyOverview(activeTicker);
                      fetchTickerExposure(activeTicker);
                    }}
                  >
                    <span>Enhance with Lakehouse and Gemini</span>
                  </button>
                </div>
            )}
          </div>
        </div>
      )}
      {showLakehouseDetailsModal && (
        <div 
          className="modal-backdrop" 
          onClick={() => setShowLakehouseDetailsModal(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 2000
          }}
        >
          <div 
            className="glass" 
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white',
              padding: '2rem',
              borderRadius: '12px',
              maxWidth: '1000px',
              width: '95%',
              maxHeight: '90vh',
              overflowY: 'auto'
            }}
          >
            <button 
              style={{ 
                float: 'right', 
                border: 'none', 
                background: 'none', 
                fontSize: '1.5rem', 
                cursor: 'pointer',
                color: 'var(--text-secondary)'
              }}
              onClick={() => setShowLakehouseDetailsModal(false)}
            >×</button>
            <h2 style={{ color: 'var(--cymbal-green)', marginBottom: '1.5rem', textAlign: 'center' }}>
              Lakehouse Details for {lakehouseDetailsData?.iceberg?.[0]?.Symbol || activeTicker}
            </h2>

            {loadingLakehouseDetails ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', gap: '0.5rem' }}>
                <div className="spinner"></div>
                <span>Loading Google Cloud Lakehouse & Iceberg details...</span>
              </div>
            ) : lakehouseDetailsData ? (
              expandedItem ? (
                <div style={{ padding: '1rem' }}>
                  <button 
                    style={{ background: 'none', border: '1px solid var(--cymbal-green)', color: 'var(--cymbal-green)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', marginBottom: '1.5rem' }}
                    onClick={() => setExpandedItem(null)}
                  >
                    ← Back to Details
                  </button>
                  <h3 style={{ color: 'var(--cymbal-green)', marginBottom: '1.5rem' }}>{expandedItem.title}</h3>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.95rem', lineHeight: '1.6', background: 'rgba(0,0,0,0.03)', padding: '1.5rem', borderRadius: '8px' }}>
                    {expandedItem.content}
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.5rem', alignItems: 'stretch' }}>
                    <div style={{ flex: 3 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <h4 style={{ color: 'var(--cymbal-green)', margin: 0, fontSize: '1rem' }}>Iceberg 10-K Data</h4>
                      </div>
                      <div style={{ overflowX: 'auto', background: 'rgba(0,0,0,0.02)', padding: '1rem', borderRadius: '8px', height: 'calc(100% - 2rem)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                          <thead>
                            <tr style={{ borderBottom: '2px solid var(--text-secondary)' }}>
                              {['Symbol', 'Security Name', 'Iceberg Company', 'CIK', 'SIC', 'Company', 'Date'].map(col => (
                                <th key={col} style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>{col}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                              <td style={{ padding: '0.5rem' }}>{lakehouseDetailsData.iceberg[0].Symbol}</td>
                              <td style={{ padding: '0.5rem' }}>{lakehouseDetailsData.iceberg[0].Security_Name}</td>
                              <td style={{ padding: '0.5rem' }}>{lakehouseDetailsData.iceberg[0].iceberg_company_name}</td>
                              <td style={{ padding: '0.5rem' }}>{lakehouseDetailsData.iceberg[0].cik}</td>
                              <td style={{ padding: '0.5rem' }}>{lakehouseDetailsData.iceberg[0].sic}</td>
                              <td style={{ padding: '0.5rem' }}>{lakehouseDetailsData.iceberg[0].company}</td>
                              <td style={{ padding: '0.5rem' }}>{new Date(lakehouseDetailsData.iceberg[0].date).toLocaleDateString()}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                    
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <h4 style={{ margin: 0, fontSize: '1rem', visibility: 'hidden' }}>Market Cap</h4>
                        <span 
                          style={{ color: 'var(--cymbal-green)', cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline', fontWeight: 'bold' }}
                          onClick={() => {
                            setCurrentSql(lakehouseDetailsData.iceberg_sql || 'No SQL returned');
                            setShowDrawer(true);
                          }}
                        >
                          Show SQL
                        </span>
                      </div>
                      <div style={{ flex: 1, background: 'linear-gradient(135deg, var(--cymbal-green), #0b6636)', color: 'white', padding: '1.5rem', borderRadius: '8px', display: 'flex', flexDirection: 'column', justifyContent: 'center', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
                        <div style={{ fontSize: '0.85rem', opacity: 0.9, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Market Cap</div>
                        <div style={{ fontSize: '1.75rem', fontWeight: 'bold', marginTop: '0.25rem' }}>
                          {lakehouseDetailsData.iceberg[0].mkt_cap ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact' }).format(lakehouseDetailsData.iceberg[0].mkt_cap) : 'N/A'}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginBottom: '1.5rem' }}>
                    <h4 style={{ color: 'var(--cymbal-green)', margin: '0 0 0.75rem 0', fontSize: '1rem' }}>Return Metrics</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.75rem' }}>
                      {[
                        { label: '1 Day Return', key: 'f_1_day_return' },
                        { label: '3 Day Return', key: 'f_3_day_return' },
                        { label: '5 Day Return', key: 'f_5_day_return' },
                        { label: '10 Day Return', key: 'f_10_day_return' },
                        { label: '20 Day Return', key: 'f_20_day_return' },
                        { label: '40 Day Return', key: 'f_40_day_return' },
                        { label: '60 Day Return', key: 'f_60_day_return' },
                        { label: '80 Day Return', key: 'f_80_day_return' },
                        { label: '100 Day Return', key: 'f_100_day_return' },
                        { label: '150 Day Return', key: 'f_150_day_return' },
                        { label: '252 Day Return', key: 'f_252_day_return' }
                      ].map(item => {
                        const val = item.isUSD ? item.val : lakehouseDetailsData.iceberg[0][item.key];
                        if (val === undefined || val === null) return null;
                        
                        let formatted = 'N/A';
                        let color = 'inherit';
                        
                        if (item.isUSD) {
                          formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact' }).format(val);
                        } else {
                          const rawVal = Number(val);
                          const percentGain = (rawVal - 1) * 100;
                          formatted = `${percentGain.toFixed(2)}%`;
                          color = percentGain >= 0 ? 'green' : 'red';
                        }
                        
                        return (
                          <div key={item.label} style={{ background: 'rgba(0,0,0,0.03)', padding: '0.75rem', borderRadius: '6px' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{item.label}</div>
                            <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: color, marginTop: '0.25rem' }}>
                              {formatted}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>


                  <div style={{ marginBottom: '1.5rem' }}>
                    <h4 style={{ color: 'var(--cymbal-green)', margin: '0 0 0.75rem 0', fontSize: '1rem' }}>Corporate Narrative Chunks</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem' }}>
                      {Array.from({ length: 15 }, (_, i) => `item_${i + 1}`).map(itemKey => {
                        const content = lakehouseDetailsData.iceberg[0][itemKey];
                        if (!content) return null;
                        return (
                          <div 
                            key={itemKey}
                            style={{ background: 'rgba(0,0,0,0.03)', padding: '1rem', borderRadius: '6px', cursor: 'pointer', textAlign: 'left', transition: 'background 0.2s' }}
                            onClick={() => setExpandedItem({ title: itemKey.toUpperCase().replace('_', ' '), content })}
                            onMouseOver={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.08)'}
                            onMouseOut={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.03)'}
                          >
                            <div style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>{itemKey.toUpperCase().replace('_', ' ')}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-primary)', marginTop: '0.5rem', fontStyle: 'italic', opacity: 0.8 }}>
                              "{content.slice(0, 60)}..."
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>Click to expand</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>


                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h3 style={{ color: 'var(--cymbal-green)', margin: 0 }}>13F Holdings Data</h3>
                    <span 
                      style={{ color: 'var(--cymbal-green)', cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline', fontWeight: 'bold' }}
                      onClick={() => {
                        setCurrentSql(lakehouseDetailsData.holdings_sql || 'No SQL returned');
                        setShowDrawer(true);
                      }}
                    >
                      Show SQL
                    </span>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid var(--text-secondary)' }}>
                          {lakehouseDetailsData.holdings && lakehouseDetailsData.holdings.length > 0 ? (
                            Object.keys(lakehouseDetailsData.holdings[0]).map((key) => (
                              <th key={key} style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>{key}</th>
                            ))
                          ) : <th>No Data</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {lakehouseDetailsData.holdings && lakehouseDetailsData.holdings.map((row, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                            {Object.entries(row).map(([key, val], i) => {
                              let displayVal = String(val);
                              if (key === 'value_usd' && val !== null && val !== undefined) {
                                displayVal = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(val));
                              } else if (key === 'shares' && val !== null && val !== undefined) {
                                displayVal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(val));
                              }
                              return (
                                <td key={i} style={{ padding: '0.5rem' }}>{displayVal}</td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) ) : (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                No details found.
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

export default App

