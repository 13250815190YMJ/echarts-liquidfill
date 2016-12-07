var echarts = require('echarts');
var numberUtil = require('echarts/lib/util/number');
var parsePercent = numberUtil.parsePercent;

var LiquidLayout = require('./liquidFillLayout');

function getShallow(model, path) {
    return model && model.getShallow(path);
}

echarts.extendChartView({

    type: 'liquidFill',

    render: function (seriesModel, ecModel, api) {
        var group = this.group;
        group.removeAll();

        var data = seriesModel.getData();

        var itemModel = data.getItemModel(0);

        var center = itemModel.get('center');
        var radius = itemModel.get('radius');

        // itemStyle
        var backgroundColor = seriesModel.get(
            'itemStyle.normal.backgroundColor'
        );
        var borderColor = seriesModel.get('outline.itemStyle.borderColor');
        var borderWidth = seriesModel.get('outline.itemStyle.borderWidth');
        var borderDistance = seriesModel.get('outline.borderDistance');

        var width = api.getWidth();
        var height = api.getHeight();
        var size = Math.min(width, height);
        var cx = parsePercent(center[0], width);
        var cy = parsePercent(center[1], height);
        var borderWidth = parsePercent(borderWidth, size);
        var outterRadius = parsePercent(radius, size) / 2;
        var innerRadius = outterRadius - borderWidth;
        var paddingRadius = parsePercent(borderDistance, size);

        var wavePath = null;

        var borderRing = new echarts.graphic.Ring({
            shape: {
                cx: cx,
                cy: cy,
                r: innerRadius,
                r0: outterRadius
            },
            style: {
                fill: borderColor
            }
        });
        group.add(borderRing);

        var radius = innerRadius - paddingRadius;
        var waveLength = parsePercent(itemModel.get('waveLength'), radius * 2);
        var left = cx - radius;
        var top = cy - radius;

        group.add(getBackground());

        // each data item for a wave
        var oldData = this._data;
        var waves = [];
        data.diff(oldData)
            .add(function (idx) {
                var wave = getWave(idx, false);

                var waterLevel = wave.shape.waterLevel;
                wave.shape.waterLevel = radius;
                echarts.graphic.initProps(wave, {
                    shape: {
                        waterLevel: waterLevel
                    }
                }, seriesModel);
                setWaveAnimation(idx, wave);

                group.add(wave);
                data.setItemGraphicEl(idx, wave);
                waves.push(wave);
            })
            .update(function (newIdx, oldIdx) {
                var oldWave = oldData.getItemGraphicEl(oldIdx);

                // new wave is used to calculate position, but not added
                var newWave = getWave(newIdx, false, oldWave);
                // update old wave with parameters of new wave
                echarts.graphic.updateProps(oldWave, {
                    shape: newWave.shape
                }, seriesModel);

                setWaveAnimation(newIdx, oldWave);
                group.add(oldWave);
                data.setItemGraphicEl(newIdx, oldWave);
                waves.push(oldWave);
            })
            .remove(function (idx) {
                var wave = oldData.getItemGraphicEl(idx);
                group.remove(wave);
            })
            .execute();

        group.add(getText(waves));

        this._data = data;

        /**
         * sky circle for wave
         */
        function getBackground() {
            return new echarts.graphic.Circle({
                shape: {
                    cx: cx,
                    cy: cy,
                    r: radius
                },
                style: {
                    fill: backgroundColor
                }
            });
        }

        /**
         * wave shape
         */
        function getWave(idx, isInverse, oldWave) {
            var itemModel = data.getItemModel(idx);
            var itemStyleModel = itemModel.getModel('itemStyle');
            var phase = itemModel.get('phase');
            var direction = itemModel.get('direction');
            var amplitude = itemModel.get('amplitude');
            var opacity = itemModel.get('itemStyle.normal.opacity');

            var value = data.get('value', idx);
            var waterLevel = radius - value * radius * 2;
            var phase = oldWave ? oldWave.shape.phase : idx * Math.PI / 4;
            var waterColor = data.getItemVisual(idx, 'color');

            var x = radius * 2;

            var wave = new LiquidLayout({
                shape: {
                    waveLength: waveLength,
                    radius: radius,
                    cx: x,
                    cy: 0,
                    waterLevel: waterLevel,
                    amplitude: amplitude,
                    borderWidth: borderWidth,
                    borderDistance: paddingRadius,
                    phase: phase,
                    inverse: isInverse
                },
                style: {
                    fill: waterColor,
                    opacity: opacity
                },
                position: [cx, cy]
            });
            wave.shape._waterLevel = waterLevel;

            var hoverStyle = itemStyleModel.getModel('emphasis').getItemStyle();
            hoverStyle.lineWidth = 0;
            echarts.graphic.setHoverStyle(wave, hoverStyle);

            // clip out the part outside the circle
            wave.setClipPath(new echarts.graphic.Circle({
                shape: {
                    cx: 0,
                    cy: 0,
                    r: radius
                }
            }));

            return wave;
        }

        function setWaveAnimation(idx, wave) {
            var itemModel = data.getItemModel(idx);

            var maxSpeed = itemModel.get('speed');
            var direction = itemModel.get('direction');

            var value = data.get('value', idx);
            var value0 = data.get('value', 0);
            var phase = wave.shape.phase || idx * Math.PI / 3;

            var defaultSpeed = function (maxSpeed) {
                var cnt = data.count();
                return cnt === 0 ? maxSpeed : maxSpeed *
                    (0.2 + (cnt - idx) / cnt * 0.8);
            };
            var speed = typeof maxSpeed === 'function'
                ? maxSpeed(value, idx) : defaultSpeed(maxSpeed);

            // phase for moving left/right
            var phaseOffset = 0;
            if (direction === 'right' || direction == undefined) {
                phaseOffset = Math.PI;
            }
            else if (direction === 'left') {
                phaseOffset = -Math.PI;
            }
            else if (direction === 'none') {
                phaseOffset = 0;
            }
            else {
                console.error('Illegal direction value for liquid fill.');
            }

            // wave animation of moving left/right
            wave
                .animate()
                .stop();
            wave
                .animate('shape', true)
                .when(0, {
                    phase: phase
                })
                .when(speed / 2, {
                    phase: phaseOffset + phase
                })
                .when(speed, {
                    phase: phaseOffset * 2 + phase
                })
                .during(function () {
                    if (wavePath) {
                        wavePath.dirty(true);
                    }
                })
                .start();
        }

        /**
         * text on wave
         */
        function getText(waves) {
            var labelModel = itemModel.getModel('label.normal');
            var labelHoverModel = itemModel.getModel('label.emphasis');
            var textStyle = labelModel.getModel('textStyle');
            var textHoverStyle = labelHoverModel.getModel('textStyle');

            function formatLabel() {
                var value = data.get('value', 0);
                var labelFormatter = labelModel.get('formatter');
                if (labelFormatter) {
                    if (typeof labelFormatter === 'string') {
                        return labelFormatter.replace('{value}', value || '');
                    }
                    else if (typeof labelFormatter === 'function') {
                        return labelFormatter(value);
                    }
                }
                else {
                    return Math.ceil(value * 100) + '%';
                }
            }

            var outsideStyle = {
                text: formatLabel(),
                x: cx,
                y: cy,
                fill: textStyle.get('color'),
                textAlign: labelModel.get('textAlign'),
                textVerticalAlign: labelModel.get('textVerticalAlign'),
                textFont: textStyle.getFont()
            };

            var outsideText = new echarts.graphic.Text({
                style: outsideStyle
            });

            var insideStyle = Object.assign({}, outsideStyle);
            insideStyle.fill = textStyle.get('insideColor');
            var insideText = new echarts.graphic.Text({
                style: insideStyle
            });

            var hoverStyle = Object.assign({}, outsideStyle);
            hoverStyle.fill = textHoverStyle.get('color');
            hoverStyle.textFont = textHoverStyle.getFont();
            outsideText.hoverStyle = hoverStyle;

            var hoverInsideStyle = Object.assign({}, outsideStyle);
            hoverInsideStyle.fill = textHoverStyle.get('insideColor');
            hoverInsideStyle.textFont = textHoverStyle.getFont();
            insideText.hoverStyle = hoverInsideStyle;

            // clip out waves for insideText
            var boundingCircle = new echarts.graphic.Circle({
                shape: {
                    cx: 0,
                    cy: 0,
                    r: radius
                }
            });

            wavePath = new echarts.graphic.CompoundPath({
                shape: {
                    paths: waves
                },
                position: [cx, cy]
            });

            wavePath.setClipPath(boundingCircle);
            insideText.setClipPath(wavePath);

            insideText.z2 = 10;
            outsideText.z2 = 10;

            var group = new echarts.graphic.Group();
            group.add(outsideText);
            group.add(insideText);

            echarts.graphic.setHoverStyle(group);

            return group;
        }
    }
});
