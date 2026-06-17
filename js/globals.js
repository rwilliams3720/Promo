// ── CONFIG ──────────────────────────────────────────────────────────────────
let _supabase = null;
let _userId   = null;
let _userEmail= null;
let _isAdmin  = false;
let _acctStatus = 'trial';
let _trialExpired = false;
let _currentPlan = 'basic';
let _selectedPlan = null;
let _columnMap  = {};
let _pendingUploadData   = null;
let _pendingUploadType   = null;
let _pendingUnknownTypes = null;
let _uploadInProgress    = false;
let _perfData    = null;
let _perfSortCol = null; // r[] index: 1=agent 3=placed 4=answered 5=vm 6=missed 7=talk 8=avg 9=max
let _perfSortDir = 1;    // 1=asc -1=desc
let _session  = null;
let _adminRows = [];
let _accessLogEntries = [];
let _alSearchTimer = null;
let _raceData  = [];
let _raceAutoRefreshTimer = null;
let _processingToken = null;
let _analysisAt = null; // ai_analysis_at from accounts table — authoritative per-account timer
let _isMember         = false;  // true when logged in as a team member (not account owner)
let _memberRole       = null;   // 'captain'|'chief_officer'|'bosun'|'custom'
let _memberCustomTabs = [];     // allowed tab names for custom role
let _ownerUserId      = null;   // owner's user_id when _isMember is true
let _ownerCompany     = '';     // owner's company name shown in header
let _dataUserId       = null;   // use for all data queries (= _ownerUserId || _userId)
let _memberAgentId    = null;   // roster_agent_id for the logged-in member (non-owner)
let _managedMemberIds = [];     // for captains/COs: member IDs they manage
let _managedAgentIds  = [];     // derived: roster_agent_id values of managed members
let _allMembersList   = [];     // all loaded member rows, for manager picker
let _memberOrgTree   = [];      // built from /api/member-org for owner/captain
let _memberOrgLoaded = false;

const PLAN_PRICES = { basic: 25, pro: 35, premium: 50 };
const PLAN_FEATURES = {
  basic:   'Dashboard + Race Tracker',
  pro:     'Dashboard + Daily Reports',
  premium: 'Dashboard + Reports + AI Analysis',
};

const COL_FIELDS = ['product','written_by','written_date','policy_name','policy_type','written_premium'];
const FIELD_LABELS = {
  product:         'Product / LOB',
  written_by:      'Written By (agent)',
  written_date:    'Written Date',
  policy_name:     'Policy Name / Number',
  policy_type:     'Policy Type',
  written_premium: 'Written Premium',
};
const FIELD_HINTS = {
  product:         'Policy line sold — e.g. Whole Life, Term, Auto, Health, Fire',
  written_by:      'Agent or producer name — assigns each sale to an agent',
  written_date:    'Date the policy was written or sold',
  policy_name:     'Optional — insured name or policy # used for deduplication',
  policy_type:     'Optional — fallback category when Product column is ambiguous',
  written_premium: 'Optional — dollar amount of the written premium (Premium plan reports)',
};

const COLORS = ['#00d4ff','#00ff94','#ffd166','#ff8c42','#b0bec5','#ff4d6d','#a78bfa','#34d399','#f472b6','#fb923c','#60a5fa'];
const FORM_ITEM_DEFS = [
  { key: 'wfolder', label: 'w:/ Folder', editable: false },
  { key: 'GSD',     label: 'GSD',        editable: false },
  { key: 'DSS',     label: 'DSS',        editable: false },
  { key: 'SCD',     label: 'SCD',        editable: false },
  { key: 'DTD',     label: 'DTD',        editable: false },
  { key: 'SFPP',    label: 'SFPP',       editable: false },
  { key: 'other1',  label: 'Other',      editable: true  },
  { key: 'other2',  label: 'Other 2',    editable: true  },
  { key: 'other3',  label: 'Other 3',    editable: true  },
];
const DEFAULT_FORM_ITEMS = {
  wfolder: { show: true, required: false, title: 'W:/ Folder', description: '', link_label: '', link_url: '' },
  GSD:  { show: true, required: false, title: 'Good Student Discount (GSD)',
    req_submitted: false, req_notified: false, req_wfi: false, req_notif_date: false,
    link_label: 'Driver Training Discount details', link_url: 'https://www.statefarm.com/insurance/auto/car-insurance-for-teens',
    description: "We're happy to inform you that the Good Student Discount (GSD) has been applied to your policy for drivers under age 25. To maintain this discount, all assigned drivers under 25 must meet certain academic qualifications, such as ranking in the top 20% of their class, earning a 3.0 GPA or higher on a 4.0 scale, making the Dean's List or Honor Roll, or achieving comparable academic standards.\n\nFor current full-time students, a recent scholastic record or a certified statement from a school official showing these achievements is required. Please provide the appropriate certification or academic records to confirm eligibility and continue receiving this discount." },
  DSS:  { show: true, required: false, title: 'Drive Safe & Save® (DSS)',
    req_submitted: false, req_notified: false, req_wfi: false, req_notif_date: false,
    link_label: 'Drive Safe & Save® enrollment', link_url: 'https://www.statefarm.com/insurance/auto/discounts/drive-safe-save',
    description: "The Drive Safe & Save® discount rewards safe driving habits by using a mobile app to monitor your driving. Enroll through the State Farm app or website and continue practicing safe driving habits to maintain and potentially increase your savings." },
  SCD:  { show: true, required: false, title: 'Steer Clear® Safe Driver Discount (SCD)',
    req_submitted: false, req_notified: false, req_wfi: false, req_notif_date: false,
    link_label: 'Steer Clear® program info', link_url: 'https://www.statefarm.com/insurance/auto/discounts/steer-clear',
    description: "We're pleased to let you know that the Steer Clear® Safe Driver discount (SCD) has been applied to your policy. This discount rewards eligible drivers under age 25 who complete the State Farm® Steer Clear program, which includes finishing 5 learning modules and completing 5 hours of driving over at least 10 trips.\n\nTo help you complete the program, text STEER to 42407 to download the Steer Clear app. Materials are also available at statefarm.com." },
  DTD:  { show: true, required: false, title: 'Driver Training Discount (DTD)',
    req_submitted: false, req_notified: false, req_wfi: false, req_notif_date: false,
    link_label: 'Driver Training Discount details', link_url: 'https://www.statefarm.com/insurance/auto/car-insurance-for-teens',
    description: "The Driver Training Discount (DTD) has been applied to your policy. This discount rewards drivers under age 21 who have completed an approved driver education course. Please provide a certification or proof of completion to maintain this discount." },
  SFPP: { show: true, required: false, title: 'State Farm Premier Package (SFPP)',
    req_submitted: false, req_notified: false, req_wfi: false, req_notif_date: false,
    description: '', link_label: '', link_url: '' },
  other1: { show: false, required: false, title: '', req_submitted: false, req_notified: false, req_wfi: false, req_notif_date: false, description: '', link_label: '', link_url: '', label: '' },
  other2: { show: false, required: false, title: '', req_submitted: false, req_notified: false, req_wfi: false, req_notif_date: false, description: '', link_label: '', link_url: '', label: '' },
  other3: { show: false, required: false, title: '', req_submitted: false, req_notified: false, req_wfi: false, req_notif_date: false, description: '', link_label: '', link_url: '', label: '' },
};
const DEFAULT_REQUIRED_FIELDS = { appt_date: true, appt_time: true, meeting_type: true, location: true };
const AGENT_COLORS = {};

const DEFAULT_SCORING = {
  wl:5, ul:4, term:3, health:3, auto:2, fire:2, deposit:0, other:0, other2:0, other3:0, other4:0, other5:0,
  placed_sales:8, placed_service:6, answered_sales:4, answered_service:3,
  talk_per_min:0.5, avg_min:1, missed_deduct:-2, voicemail_deduct:-1,
  wl_enabled:1, ul_enabled:1, term_enabled:1, health_enabled:1, auto_enabled:1, fire_enabled:1,
  deposit_enabled:0, other_enabled:0, other2_enabled:0, other3_enabled:0, other4_enabled:0, other5_enabled:0,
};
let SCORING = {...DEFAULT_SCORING};
let CAT_LABELS = { deposit:'Deposit', other:'Other', other2:'Other 2', other3:'Other 3', other4:'Other 4', other5:'Other 5' };
let _raceWideMissed = 0;
let _raceWideVm     = 0;

// ── DIRECTIVE 2 — Sales Add-On state ─────────────────────────────────────────
let _hasSalesAddon    = false;
let _salesEntryMode   = 'upload';   // 'upload' | 'manual'
// ── Commissions Add-On state ─────────────────────────────────────────────────
let _hasCommissionsAddon = false;
let _commissionBankConfig = {};     // { enabled, cap_per_period, interest_rate }
let _commissionStructures = [];     // [{id, name, default_split_ratio, rates}]
let _activityTypes        = [];     // [{id, name, category, subcategory, source, call_disposition, active}]
let _bonusLogEntries      = [];
let _bonusLogCallTotals   = [];
let _bonusLogMonth        = new Date().getMonth() + 1;
let _bonusLogYear         = new Date().getFullYear();
let _commMonth    = '';             // 'YYYY-MM'
let _commData     = null;           // last loaded commissions response
let _commPayments = {};             // agentId → paid object (populated by renderCommissions)
let _checklistToken   = null;
let _checklistEmailCfg= null;
let _checklistFormCfg = [];         // [{form_key,label,active,sort_order}]
let _salesSubcats     = [];         // [{id,scoring_category,label,is_financial_service,active,sort_order}]
let _editingSubcatId  = null;
let _productTypes     = [];         // [{key,label}] user-configured; falls back to DEFAULT_SCORING_CATS
let _editingPtKey     = null;
let _agentRoster      = [];
let _salesLocations   = [];         // [{id, name, active, sort_order}]
let _salesTileEntries = [];         // sales_log entries for current race period
let _salesTileLocation = 'all';     // selected location filter on race tile
let _leadSources       = [];        // user-configured lead source list (falls back to LEAD_SOURCES constant)
let _salesLogLocationFilter = 'all'; // location filter for sales log
let _selfReportConfig = {};  // { activities_enabled, sales_enabled, requires_approval, req_act_notes, req_sales_fields:{} }

// ── Member Analysis add-on state ─────────────────────────────────────────────
let _hasMemberAnalysis    = false;
let _memberAnalysisCount  = 0;
let _analysisCredits      = null;
let _creditWaived         = false;
let _memberAnalysisAgents = [];
let _memberAnalysisAt     = null;
let _memberAnalysisAgentsSetAt = null;
let _leadAnalysisAt         = null;
let _leadAnalysisLoading    = false;
let _hasLeadAnalysisAddon   = false;
let _agentGoals       = [];
let _goalsLoaded      = false;
let _goalsViewFilter  = 'all';
let _raceCurrentMonth = '';
let _memberAnalysisLoading = false;
let _memberHoursData      = [];   // periods array from accounts.member_hours_data
let _maHoursFileRows      = [];   // raw parsed rows from dropped file
let _maHoursHeaders       = [];   // column headers from dropped file
let _maCurKey             = '';   // "May 2026" from last analysis response
let _maLastHoursPeriod    = null; // last uploaded period label for label display
let _maAnalysisData       = null; // last loaded member analysis response
let _agentChartInstances  = {};   // agId → [Chart, Chart, Chart]
let _agentChartsRendered  = new Set();

