import { loadPaper } from './paperLoader';
import { InfillPattern, InfilledPath } from './types';

const paper = loadPaper();

const MIN_INFILL_LENGTH = 2; // mm - minimum length for an infill line segment

const patternAngles: Record<string, number[]> = {
    'horizontal': [0],
    'vertical': [Math.PI / 2],
    'diagonal45': [Math.PI / 4],
    'diagonal135': [3 * Math.PI / 4],
    'crosshatch': [Math.PI / 4, 3 * Math.PI / 4],
};

export function generateInfills(pathsToInfill: paper.PathItem[], infillPattern: InfillPattern, infillSpacing: number): InfilledPath[] {
    const view = paper.project.view;
    const boundsPath = new paper.Path.Rectangle(view.bounds);

    let lines: paper.Path.Line[] = [];
    if (infillPattern !== 'none' && infillPattern !== 'concentric') {
        const angles = patternAngles[infillPattern];
        if (angles) {
            lines = generateScanLines(angles, infillSpacing, view.size.width, view.size.height);
        }
    }

    const infilledPaths = pathsToInfill.map(path => {
        if (path.fillColor && path.fillColor.toCSS(true) === '#ffffff' && !path.strokeColor) {
            return null;
        }

        const outlinePaths: paper.Path[] = [];

        if (path instanceof paper.Path) {
            if (path.firstSegment && path.lastSegment) {
                outlinePaths.push(path);
            }
        } else if (path instanceof paper.CompoundPath) {
            const unwoundPaths = unwrapCompoundPath(path).filter(p => p.firstSegment && p.lastSegment);
            outlinePaths.push(...unwoundPaths);
        } else {
            throw new Error("Path item is neither a Path or CompoundPath");
        }

        let infillPaths: paper.Path[] = [];

        if (infillPattern !== 'none' && (!path.fillColor || path.fillColor.toCSS(true) !== '#ffffff')) {
            if (infillPattern === 'concentric') {
                infillPaths = generateConcentricInfill(path, infillSpacing);
            } else {
                infillPaths = intersectLinesWithPath(lines, path, boundsPath);
            }
        }

        const infilledPath: InfilledPath = {
            originalPath: path,
            infillPaths,
            outlinePaths,
        };

        return infilledPath;
    }).filter((ip) => !!ip) as InfilledPath[];

    return infilledPaths;
}

function generateScanLines(angles: number[], spacing: number, viewWidth: number, viewHeight: number): paper.Path.Line[] {
    const lines: paper.Path.Line[] = [];
    const diagonal = Math.sqrt(viewWidth * viewWidth + viewHeight * viewHeight);

    for (const angle of angles) {
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);

        // Normal to the line direction
        const nx = -sinA;
        const ny = cosA;

        // Project view corners onto normal to find range
        const projections = [
            0,
            viewWidth * nx,
            viewHeight * ny,
            viewWidth * nx + viewHeight * ny,
        ];
        const minProj = Math.min(...projections);
        const maxProj = Math.max(...projections);

        for (let d = minProj; d <= maxProj; d += spacing) {
            const px = d * nx;
            const py = d * ny;
            lines.push(new paper.Path.Line(
                { x: px - diagonal * cosA, y: py - diagonal * sinA },
                { x: px + diagonal * cosA, y: py + diagonal * sinA }
            ));
        }
    }

    return lines;
}

function intersectLinesWithPath(lines: paper.Path.Line[], path: paper.PathItem, boundsPath: paper.Path): paper.Path[] {
    const infillPaths: paper.Path[] = [];

    for (const line of lines) {
        const intersections = [
            ...path.getIntersections(line),
            ...boundsPath.getIntersections(line),
        ].filter(i => i.point.isInside(boundsPath.bounds));

        intersections.sort((a, b) => a.point.x - b.point.x || a.point.y - b.point.y);

        let currentLineGroup: paper.Point[] = [];
        function saveCurrentLineAsPath() {
            if (currentLineGroup.length > 1) {
                const infillLine = new paper.Path.Line(currentLineGroup[0], currentLineGroup[currentLineGroup.length - 1]);
                if (infillLine.length > MIN_INFILL_LENGTH) {
                    infillPaths.push(infillLine);
                }
            }
        }

        for (const intersection of intersections) {
            if (currentLineGroup.length === 0) {
                currentLineGroup.push(intersection.point);
            } else {
                const previousPoint = currentLineGroup[currentLineGroup.length - 1];
                const thisPoint = intersection.point;
                const midPoint = getMidPoint(previousPoint, thisPoint);
                if (path.contains(midPoint)) {
                    currentLineGroup.push(thisPoint);
                } else {
                    saveCurrentLineAsPath();
                    currentLineGroup = [thisPoint];
                }
            }
        }
        saveCurrentLineAsPath();
    }

    return infillPaths;
}

function generateConcentricInfill(path: paper.PathItem, spacing: number): paper.Path[] {
    const infillPaths: paper.Path[] = [];
    const center = path.bounds.center;
    const maxDim = Math.max(path.bounds.width, path.bounds.height);

    if (maxDim <= spacing * 2) return infillPaths;

    const scaleStep = (2 * spacing) / maxDim;

    for (let scale = 1 - scaleStep; scale > 0.01; scale -= scaleStep) {
        const clone = path.clone({ insert: false });
        clone.scale(scale, center);

        if (clone instanceof paper.Path) {
            if (clone.length > MIN_INFILL_LENGTH) {
                clone.flatten(0.5);
                infillPaths.push(clone);
            }
        } else if (clone instanceof paper.CompoundPath) {
            for (const child of clone.children) {
                if (child instanceof paper.Path && (child as paper.Path).length > MIN_INFILL_LENGTH) {
                    (child as paper.Path).flatten(0.5);
                    infillPaths.push(child as paper.Path);
                }
            }
        }
    }

    return infillPaths;
}

function getMidPoint(point1: paper.Point, point2: paper.Point): paper.Point {
    return new paper.Point(
        point1.x + (point2.x - point1.x) / 2,
        point1.y + (point2.y - point1.y) / 2,
    );
}

function unwrapCompoundPath(path: paper.CompoundPath) {
    const paths: paper.Path[] = [];
    for (const child of path.children) {
        if (child instanceof paper.Path) {
            paths.push(child);
        } else if (child instanceof paper.CompoundPath) {
            paths.push(...unwrapCompoundPath(child));
        }
    }

    return paths;
}
