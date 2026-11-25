// 외부 라이브러리는 이 파일에서만 불러온다(버전 고정). 다른 모듈은 여기서 가져다 쓴다.
export { html, render, useState, useEffect, useCallback, useMemo, useRef } from 'https://unpkg.com/htm@3.1.1/preact/standalone.module.js';
export { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
