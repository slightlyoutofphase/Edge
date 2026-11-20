import React, { useEffect, useRef, useState } from "react";
import { Game } from "../core/Game";
import type { TestFileResult, TestResult } from "../tests/TestRunner";

interface TestRunnerViewProps {
  gameRef: React.MutableRefObject<Game | null>;
  onQuitToMenu: () => void;
}

export const TestRunnerView: React.FC<TestRunnerViewProps> = ({ gameRef, onQuitToMenu }) => {
  const [fileResults, setFileResults] = useState<TestFileResult[] | null>(null);
  const [testResults, setTestResults] = useState<TestResult[] | null>(null);
  const [currentFile, setCurrentFile] = useState<{
    file: string;
    index: number;
    total: number;
  } | null>(null);
  const [isRunningTests, setIsRunningTests] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isRunningTests && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "auto", block: "end" });
    }
  }, [fileResults?.length, currentFile?.index, isRunningTests]);

  const handleRunTests = async () => {
    if (!gameRef.current) return;
    setIsRunningTests(true);
    setFileResults([]);
    setTestResults([]);
    setCurrentFile(null);
    setCopySuccess(false);
    try {
      const { TestRunner } = await import("../tests/TestRunner");
      const runner = new TestRunner(gameRef.current);
      const results = await runner.runTests({
        onFileStart: (file, fileIndex, totalFiles) => {
          setCurrentFile({ file, index: fileIndex + 1, total: totalFiles });
        },
        onFileComplete: (fileResult) => {
          setFileResults((prev) => [...(prev ?? []), fileResult]);
          setTestResults((prev) => [...(prev ?? []), ...fileResult.results]);
        },
      });
      setTestResults(results);
    } catch (error) {
      const errResult: TestResult = {
        name: "Test runner",
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      };
      setFileResults((prev) => [
        ...(prev ?? []),
        { file: "TestRunner", results: [errResult], durationMs: 0 },
      ]);
      setTestResults((prev) => [...(prev ?? []), errResult]);
    } finally {
      setIsRunningTests(false);
      setCurrentFile(null);
    }
  };

  const getSummaryReport = (results: TestResult[], files: TestFileResult[] | null) => {
    const total = results.length;
    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;
    let report = `Test Run Summary\n----------------\nTotal Tests: ${total}\nPassed:      ${passed}\nFailed:      ${failed}\n\n`;
    if (files && files.length > 0) {
      report += "Files:\n";
      files.forEach((f) => {
        const fPass = f.results.filter((r) => r.passed).length;
        const fFail = f.results.length - fPass;
        report += `- ${f.file}: ${fPass}/${f.results.length} passed, ${fFail} failed (${Math.round(f.durationMs)}ms)\n`;
      });
      report += "\n";
    }
    if (failed > 0) {
      report += "Failure Details:\n";
      results
        .filter((r) => !r.passed)
        .forEach((r) => {
          const name = r.name || "<Unnamed Test>";
          const prefix = r.file ? `[${r.file}] ` : "";
          report += `[FAILED] ${prefix}${name}\nReason: ${r.error}\n\n`;
        });
    } else {
      report += "All tests passed successfully.\n";
    }
    return report;
  };

  const handleCopyReport = async () => {
    if (!testResults) return;
    const report = getSummaryReport(testResults, fileResults);
    try {
      await navigator.clipboard.writeText(report);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error("Failed to copy: ", err);
    }
  };

  const totalPassed = testResults ? testResults.filter((r) => r.passed).length : 0;
  const totalFailed = testResults ? testResults.filter((r) => !r.passed).length : 0;

  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-neutral-900/95 backdrop-blur-sm p-4 md:p-8">
      <div className="w-full max-w-3xl flex flex-col h-full max-h-[95vh] md:max-h-[90vh]">
        <div className="flex justify-between items-center mb-4 md:mb-6">
          <h2 className="text-xl md:text-3xl font-black text-white uppercase tracking-tight">
            Test Runner
          </h2>
          <button
            onClick={onQuitToMenu}
            className="text-neutral-400 hover:text-white text-[10px] md:text-sm font-bold uppercase transition-colors">
            Menu
          </button>
        </div>
        <div className="bg-black/40 p-4 md:p-6 rounded-lg border border-white/10 mb-4 md:mb-6 flex items-center justify-between gap-4">
          <div className="text-neutral-400 text-[10px] md:text-sm font-mono truncate">
            {isRunningTests
              ? currentFile
                ? `Running ${currentFile.file} (${currentFile.index}/${currentFile.total})...`
                : "Preparing test runner..."
              : testResults
                ? `Complete (${fileResults?.length ?? 0} files).`
                : "Ready."}
          </div>
          <button
            onClick={handleRunTests}
            disabled={isRunningTests}
            className={`font-bold px-4 py-2 md:px-6 md:py-3 rounded transition-all text-[10px] md:text-sm uppercase min-w-[100px] md:min-w-[140px] shrink-0 ${isRunningTests ? "bg-yellow-500/20 text-yellow-200" : "bg-blue-600 text-white"}`}>
            {isRunningTests ? "Busy" : "Run Tests"}
          </button>
        </div>
        {fileResults && (
          <div className="flex-1 bg-black/60 rounded-lg border border-white/10 flex flex-col overflow-hidden shadow-2xl">
            <div className="flex justify-between items-center p-3 md:p-4 border-b border-white/10 bg-white/5">
              <div className="flex items-center gap-3">
                <h3 className="font-bold text-white text-[9px] md:text-xs uppercase tracking-wider">
                  Log
                </h3>
                <button
                  onClick={handleCopyReport}
                  disabled={!testResults || testResults.length === 0}
                  className="text-[9px] md:text-xs bg-white/10 hover:bg-white/20 disabled:opacity-40 text-neutral-300 hover:text-white px-2 py-1 rounded uppercase font-bold tracking-wider transition-colors">
                  {copySuccess ? "Copied!" : "Copy Report"}
                </button>
              </div>
              <div className="text-[9px] md:text-xs font-mono space-x-2 md:space-x-3 bg-black/50 px-2 py-0.5 md:px-3 md:py-1 rounded">
                <span className="text-green-400">{totalPassed} PASS</span>
                <span className="text-red-400">{totalFailed} FAIL</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 md:p-4 space-y-3">
              {fileResults.map((fileEntry, fileIdx) => {
                const filePassed = fileEntry.results.filter((r) => r.passed).length;
                const fileFailed = fileEntry.results.length - filePassed;
                return (
                  <div
                    key={`${fileEntry.file}-${fileIdx}`}
                    className={`rounded-lg border p-2 md:p-3 space-y-1.5 ${fileFailed > 0 ? "border-red-500/30 bg-red-500/5" : "border-white/10 bg-white/[0.02]"}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-white/10">
                      <span className="font-mono font-bold text-[10px] md:text-xs text-white">
                        {fileEntry.file}
                      </span>
                      <div className="flex items-center gap-2 font-mono text-[9px] md:text-xs">
                        <span className="text-neutral-400">
                          {Math.round(fileEntry.durationMs)}ms
                        </span>
                        <span className="text-green-400">{filePassed} PASS</span>
                        {fileFailed > 0 && <span className="text-red-400">{fileFailed} FAIL</span>}
                      </div>
                    </div>
                    <div className="space-y-1">
                      {fileEntry.results.map((r, i) => (
                        <div
                          key={i}
                          className={`flex flex-col text-[10px] md:text-sm px-2 py-1.5 rounded border ${r.passed ? "bg-green-500/5 border-transparent" : "bg-red-500/10 border-red-500/30"}`}>
                          <div className="flex justify-between items-center gap-2">
                            <span
                              className={`font-mono truncate ${r.passed ? "text-green-400" : "text-red-400 font-bold"}`}>
                              {r.name || "<Unnamed Test>"}
                            </span>
                            <div className="flex items-center gap-2 shrink-0">
                              {r.durationMs !== undefined && (
                                <span className="text-[8px] md:text-[10px] font-mono text-neutral-500">
                                  {Math.round(r.durationMs)}ms
                                </span>
                              )}
                              <span
                                className={`text-[8px] md:text-[10px] uppercase font-bold ${r.passed ? "text-green-500" : "text-red-500"}`}>
                                {r.passed ? "OK" : "FAIL"}
                              </span>
                            </div>
                          </div>
                          {!r.passed && (
                            <div className="mt-2 text-[9px] md:text-xs text-red-200 font-mono bg-red-950/50 p-2 rounded border-l-2 border-red-500">
                              {r.error}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              {isRunningTests && currentFile && (
                <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-2 md:p-3 font-mono text-[10px] md:text-xs text-yellow-200">
                  Running {currentFile.file} ({currentFile.index}/{currentFile.total})...
                </div>
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
