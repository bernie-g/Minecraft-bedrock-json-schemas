@echo off
:x
quicktype -s schema entities.json -o Models.cs
goto x