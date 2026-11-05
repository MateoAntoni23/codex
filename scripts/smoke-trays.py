"""Requires optional Playwright Python + Chromium. Run after npm run dev:trays."""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM_PATH') or None,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1600,'height':1000})
    errors=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.goto('http://localhost:5173/?workspace=bandejas')
    page.get_by_role('button',name='R1 · SAM_TRES-300-065-18-Z',exact=True).wait_for(timeout=30000)
    page.get_by_role('button',name='Calcular trazado',exact=True).click()
    page.get_by_role('status').filter(has_text='vigente').wait_for(timeout=30000)
    page.get_by_role('button',name='R1 · SAM_TRES-300-065-18-Z',exact=True).click()
    page.get_by_label('Longitud de pieza mm').fill('2800')
    assert 'desactualizado' in page.get_by_role('status').inner_text()
    page.get_by_role('button',name='Calcular trazado',exact=True).click()
    page.get_by_role('status').filter(has_text='vigente').wait_for(timeout=30000)
    # Exercise each engineering edit through the real browser, then recalculate.
    page.get_by_label('Cantidad',exact=True).first.fill('4')
    assert 'desactualizado' in page.get_by_role('status').inner_text()
    page.get_by_role('button',name='Calcular trazado',exact=True).click()
    page.get_by_role('status').filter(has_text='vigente').wait_for(timeout=30000)
    page.get_by_label('Producto de catálogo').select_option('SAM_TRES-150-065-18-Z')
    assert 'desactualizado' in page.get_by_role('status').inner_text()
    page.get_by_role('button',name='Calcular trazado',exact=True).click()
    page.get_by_role('status').filter(has_text='vigente').wait_for(timeout=30000)
    page.get_by_label('S1 sobre R1 · distancia desde P1 (mm)').fill('700')
    page.get_by_label('Modelo candidato PE').select_option('PRY-SVALIO-CU-1x16')
    page.get_by_role('button',name='Calcular trazado',exact=True).click()
    page.get_by_role('status').filter(has_text='vigente').wait_for(timeout=30000)
    page.get_by_label('Recorrido (IDs separados por coma)').first.fill('R1,R2,T1,R4')
    page.get_by_role('button',name='Calcular trazado',exact=True).click()
    page.get_by_role('status').filter(has_text='vigente').wait_for(timeout=30000)
    page.get_by_role('button',name='Localizar R2',exact=True).click()
    assert page.get_by_role('heading',name='R2',exact=True).is_visible()
    # Network unavailable: latest failure must be explicit, never leave result current.
    page.route('**/api/motor/v1/**',lambda route:route.abort())
    page.get_by_role('button',name='Calcular trazado',exact=True).click()
    page.get_by_role('alert').wait_for(timeout=30000)
    assert 'vigente' not in page.get_by_role('status').inner_text()
    page.unroute('**/api/motor/v1/**')
    page.get_by_role('button',name='Calcular trazado',exact=True).click()
    page.get_by_role('status').filter(has_text='vigente').wait_for(timeout=30000)
    for name in ['caso1_4_separados','caso2_8_separados','caso3_8_contacto']:
        page.get_by_role('button',name=name,exact=True).click()
        page.wait_for_timeout(800)
    Path('artifacts').mkdir(exist_ok=True)
    page.screenshot(path='artifacts/tray-workspace.png',full_page=True)
    assert not errors,errors
    browser.close()
    print('Browser smoke OK: engine/proxy/calculation/edit/invalidation/recalculation/3 cable cases')
