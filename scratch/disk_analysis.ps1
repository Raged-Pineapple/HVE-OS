# C Drive Storage Analysis Script

Write-Output "=== C DRIVE SPACE INFORMATION ==="
Get-PSDrive C | Select-Object Name, 
    @{Name="Total_Capacity_GB"; Expression={[math]::round(($_.Used + $_.Free)/1GB, 2)}},
    @{Name="Used_Space_GB"; Expression={[math]::round($_.Used/1GB, 2)}},
    @{Name="Free_Space_GB"; Expression={[math]::round($_.Free/1GB, 2)}} | Format-List

Write-Output "`n=== DOCKER / WSL2 VIRTUAL DISKS (VHDX) ==="
$wslPath = "$env:USERPROFILE\AppData\Local\Docker\wsl"
if (Test-Path $wslPath) {
    Get-ChildItem -Path $wslPath -Recurse -Filter "*.vhdx" -ErrorAction SilentlyContinue | 
        Select-Object Name, @{Name="Size_GB"; Expression={[math]::round($_.Length/1GB, 2)}}, DirectoryName | 
        Format-Table -AutoSize
} else {
    Write-Output "Docker WSL path not found at standard path: $wslPath"
}

Write-Output "`n=== TOP 10 LARGEST FOLDERS IN USER LOCAL APPDATA ==="
$localAppData = "$env:USERPROFILE\AppData\Local"
if (Test-Path $localAppData) {
    Get-ChildItem -Path $localAppData -Directory | ForEach-Object {
        $dir = $_
        $size = 0
        try {
            $files = Get-ChildItem $dir.FullName -Recurse -File -ErrorAction SilentlyContinue
            if ($files) {
                $size = ($files | Measure-Object -Property Length -Sum).Sum
            }
        } catch {}
        [PSCustomObject]@{
            Folder_Name = $dir.Name
            Size_GB     = [math]::round($size/1GB, 3)
        }
    } | Sort-Object Size_GB -Descending | Select-Object -First 10 | Format-Table -AutoSize
} else {
    Write-Output "AppData Local path not found: $localAppData"
}

Write-Output "`n=== TOP 10 LARGEST FOLDERS IN USER ROAMING APPDATA ==="
$roamingAppData = "$env:USERPROFILE\AppData\Roaming"
if (Test-Path $roamingAppData) {
    Get-ChildItem -Path $roamingAppData -Directory | ForEach-Object {
        $dir = $_
        $size = 0
        try {
            $files = Get-ChildItem $dir.FullName -Recurse -File -ErrorAction SilentlyContinue
            if ($files) {
                $size = ($files | Measure-Object -Property Length -Sum).Sum
            }
        } catch {}
        [PSCustomObject]@{
            Folder_Name = $dir.Name
            Size_GB     = [math]::round($size/1GB, 3)
        }
    } | Sort-Object Size_GB -Descending | Select-Object -First 10 | Format-Table -AutoSize
}
