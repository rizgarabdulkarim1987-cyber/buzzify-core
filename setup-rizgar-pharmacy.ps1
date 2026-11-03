# Imports the sample products and opening stock into Rizgar Pharmacy. Run by double-clicking setup-rizgar-pharmacy.cmd.
# The database address is typed here, hidden, kept only for this window, and never written to a file.
Set-Location -Path $PSScriptRoot
$secure = Read-Host 'Paste the production DATABASE_URL (Neon) and press Enter' -AsSecureString
$url = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if (-not $url) { Write-Host 'Nothing pasted.'; Read-Host 'Press Enter to close'; exit 1 }
$env:DATABASE_URL = $url
$csv = 'docs/pharmacy/sample-data/rizgar-pharmacy-products.csv'

Write-Host "`n--- Step 1: dry run (writes nothing) ---" -ForegroundColor Cyan
npx tsx scripts/pharmacy-opening-stock.ts --import $csv
if ($LASTEXITCODE -ne 0) { Write-Host "`nStopped. Nothing was written. Send me the message above (without the address)." -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }

Write-Host "`nCheck that the 'Database:' line above is your PRODUCTION database." -ForegroundColor Yellow
$answer = Read-Host "Type YES to write the products and stock now (anything else cancels)"
if ($answer -ne 'YES') { Write-Host 'Cancelled. Nothing was written.'; Read-Host 'Press Enter to close'; exit 0 }

Write-Host "`n--- Step 2: writing ---" -ForegroundColor Cyan
npx tsx scripts/pharmacy-opening-stock.ts --import $csv --apply
if ($LASTEXITCODE -ne 0) { Write-Host "`nFailed. Send me the message above (without the address)." -ForegroundColor Red } else { Write-Host "`nDone. Now open Shifts in the pharmacy, open a shift, then try Sell." -ForegroundColor Green }
Read-Host 'Press Enter to close'
