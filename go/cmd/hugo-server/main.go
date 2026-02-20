package main

import (
	"log"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/evanw/esbuild/pkg/api"
)

func main() {
	repoDir := findRepoRoot()
	siteDir := filepath.Join(repoDir, "site")

	// Build TypeScript first, then watch for changes
	result := api.Build(buildOpts(siteDir))
	if len(result.Errors) > 0 {
		log.Fatal("esbuild build failed")
	}

	ctx, ctxErr := api.Context(watchOpts(siteDir))
	if ctxErr != nil {
		log.Fatal(ctxErr)
	}
	defer ctx.Dispose()

	if err := ctx.Watch(api.WatchOptions{}); err != nil {
		log.Fatal(err)
	}
	log.Println("esbuild watching for changes")

	// Start Hugo server
	cmd := exec.Command("hugo", "server",
		"--bind=0.0.0.0",
		"-p", "1313",
		"--disableFastRender",
		"--logLevel", "info",
		"--minify",
	)
	cmd.Dir = siteDir
	cmd.Stderr = os.Stderr
	cmd.Stdout = os.Stdout
	if err := cmd.Run(); err != nil {
		log.Fatal(err)
	}
}

func buildOpts(siteDir string) api.BuildOptions {
	return api.BuildOptions{
		EntryPoints:       []string{filepath.Join(siteDir, "ts/index.ts")},
		Outfile:           filepath.Join(siteDir, "assets/js/app.js"),
		Sourcemap:         api.SourceMapLinked,
		Bundle:            true,
		Format:            api.FormatESModule,
		Target:            api.ES2020,
		Write:             true,
		MinifyWhitespace:  true,
		MinifyIdentifiers: true,
		MinifySyntax:      true,
		Color:             api.ColorAlways,
		LogLevel:          api.LogLevelInfo,
	}
}

func watchOpts(siteDir string) api.BuildOptions {
	opts := buildOpts(siteDir)
	// In watch mode, don't minify for faster rebuilds
	opts.MinifyWhitespace = false
	opts.MinifyIdentifiers = false
	opts.MinifySyntax = false
	return opts
}

func findRepoRoot() string {
	dir, err := os.Getwd()
	if err != nil {
		log.Fatal(err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			log.Fatal("could not find repo root (no go.mod)")
		}
		dir = parent
	}
	return ""
}
